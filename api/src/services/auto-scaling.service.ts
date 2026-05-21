import os from 'os';
import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';
import { quotaManager } from './quota-manager.service';

export interface ScalingAction {
  type: 'spawn_worker' | 'throttle_render' | 'pause_ai' | 'reduce_upload_frequency' | 'cleanup_storage' | 'noop';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  queue?: string;
}

const DEFAULT_QUEUE_THRESHOLD = 20;
const SCALING_FLAG_TTL = 300;
const CPU_SAMPLE_DELAY_MS = 1000;

export class AutoScalingEngine {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  async getQueueDepth(queueName: string): Promise<number> {
    try {
      const queue = new Queue(queueName, { connection: redisConnection });
      const counts = await queue.getJobCounts();
      await queue.close();
      return counts.wait ?? 0;
    } catch (err: any) {
      logger.warn(`[AutoScaling] Failed to get queue depth for ${queueName}: ${err.message}`);
      return 0;
    }
  }

  async isQueueOverThreshold(queueName: string, threshold: number = DEFAULT_QUEUE_THRESHOLD): Promise<boolean> {
    const depth = await this.getQueueDepth(queueName);
    return depth > threshold;
  }

  async getCpuUsage(): Promise<number> {
    const startMeasure = this.getCpuTimes();
    await this.sleep(CPU_SAMPLE_DELAY_MS);
    const endMeasure = this.getCpuTimes();

    const startTotal = startMeasure.user + startMeasure.nice + startMeasure.sys + startMeasure.idle + startMeasure.irq;
    const endTotal = endMeasure.user + endMeasure.nice + endMeasure.sys + endMeasure.idle + endMeasure.irq;

    const totalDiff = endTotal - startTotal;
    const idleDiff = endMeasure.idle - startMeasure.idle;

    if (totalDiff === 0) return 0;
    return Math.round(((totalDiff - idleDiff) / totalDiff) * 100);
  }

  async getMemoryUsage(): Promise<{ usedPercent: number; freeBytes: number }> {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      usedPercent: Math.round((used / total) * 100),
      freeBytes: free,
    };
  }

  async shouldThrottleRenders(): Promise<boolean> {
    const [cpu, mem] = await Promise.all([this.getCpuUsage(), this.getMemoryUsage()]);
    return cpu > 80 || mem.usedPercent > 75;
  }

  async shouldPauseAiGeneration(): Promise<boolean> {
    const mem = await this.getMemoryUsage();
    return mem.usedPercent > 75;
  }

  async getQuotaRemaining(channelId: string): Promise<number> {
    try {
      const status = await quotaManager.getStatus(channelId);
      return status.remaining;
    } catch (err: any) {
      logger.warn(`[AutoScaling] Failed to get quota for ${channelId}: ${err.message}`);
      return 0;
    }
  }

  async getRecommendedUploadDelay(channelId: string): Promise<number> {
    const remaining = await this.getQuotaRemaining(channelId);
    if (remaining <= 0) return 3600000;
    if (remaining < 500) return 1800000;
    if (remaining < 1000) return 900000;
    if (remaining < 2000) return 600000;
    if (remaining < 3000) return 300000;
    return 0;
  }

  async shouldReduceUploadFrequency(channelId: string): Promise<boolean> {
    const remaining = await this.getQuotaRemaining(channelId);
    return remaining < 3000;
  }

  async getScalingRecommendation(): Promise<ScalingAction[]> {
    const actions: ScalingAction[] = [];

    const [cpu, mem] = await Promise.all([this.getCpuUsage(), this.getMemoryUsage()]);

    if (cpu > 90) {
      actions.push({
        type: 'spawn_worker',
        severity: 'critical',
        message: `CPU at ${cpu}% — spawning additional worker`,
        queue: 'video-render',
      });
    } else if (cpu > 80) {
      actions.push({
        type: 'throttle_render',
        severity: 'warning',
        message: `CPU at ${cpu}% — throttling render operations`,
      });
    }

    if (mem.usedPercent > 85) {
      actions.push({
        type: 'pause_ai',
        severity: 'critical',
        message: `RAM at ${mem.usedPercent}% — pausing AI generation`,
      });
      actions.push({
        type: 'cleanup_storage',
        severity: 'warning',
        message: `RAM at ${mem.usedPercent}% — triggering storage cleanup`,
      });
    } else if (mem.usedPercent > 75) {
      actions.push({
        type: 'pause_ai',
        severity: 'warning',
        message: `RAM at ${mem.usedPercent}% — pausing AI generation`,
      });
    }

    if (cpu <= 80 && mem.usedPercent <= 75) {
      actions.push({
        type: 'noop',
        severity: 'info',
        message: `System healthy — CPU: ${cpu}%, RAM: ${mem.usedPercent}%`,
      });
    }

    return actions;
  }

  async applyAction(action: ScalingAction): Promise<void> {
    logger.info(`[AutoScaling] Applying action: ${action.type} (${action.severity}) — ${action.message}`);

    try {
      switch (action.type) {
        case 'throttle_render':
          await redisConnection.setex('scaling:throttle:render', SCALING_FLAG_TTL, '1');
          break;

        case 'pause_ai':
          await redisConnection.setex('scaling:pause:ai', SCALING_FLAG_TTL, '1');
          break;

        case 'reduce_upload_frequency':
          if (action.queue) {
            const delay = await this.getRecommendedUploadDelay(action.queue);
            await redisConnection.setex(`scaling:upload-delay:${action.queue}`, SCALING_FLAG_TTL, String(delay));
          }
          break;

        case 'spawn_worker':
        case 'cleanup_storage':
          break;

        case 'noop':
          break;
      }

      await redisConnection.setex('scaling:action:last', SCALING_FLAG_TTL, JSON.stringify(action));
    } catch (err: any) {
      logger.error(`[AutoScaling] Failed to apply action ${action.type}: ${err.message}`);
    }
  }

  async evaluate(): Promise<ScalingAction[]> {
    const actions = await this.getScalingRecommendation();
    for (const action of actions) {
      await this.applyAction(action);
    }
    return actions;
  }

  startAutoScaling(intervalMs: number = 60000): void {
    if (this.intervalHandle) {
      logger.warn('[AutoScaling] Already running — stopping previous loop');
      this.stopAutoScaling();
    }

    logger.info(`[AutoScaling] Starting auto-scaling loop every ${intervalMs}ms`);
    this.intervalHandle = setInterval(async () => {
      try {
        const actions = await this.evaluate();
        logger.info(`[AutoScaling] Evaluation complete — ${actions.length} action(s) recommended`);
      } catch (err: any) {
        logger.error(`[AutoScaling] Evaluation failed: ${err.message}`);
      }
    }, intervalMs);
  }

  stopAutoScaling(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      logger.info('[AutoScaling] Stopped');
    }
  }

  private getCpuTimes(): { user: number; nice: number; sys: number; idle: number; irq: number } {
    const cpus = os.cpus();
    const totals = { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    for (const cpu of cpus) {
      totals.user += cpu.times.user;
      totals.nice += cpu.times.nice;
      totals.sys += cpu.times.sys;
      totals.idle += cpu.times.idle;
      totals.irq += cpu.times.irq;
    }
    return totals;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const autoScaling = new AutoScalingEngine();
