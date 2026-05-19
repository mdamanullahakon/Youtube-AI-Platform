import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { redisConnection } from '../../config/redis';

export type FailureType =
  | 'crash'
  | 'pipeline-step-failed'
  | 'stuck-queue'
  | 'api-timeout'
  | 'oauth-failure'
  | 'upload-failure'
  | 'ai-provider-down'
  | 'redis-connection-lost'
  | 'database-connection-lost'
  | 'disk-space-low'
  | 'rate-limited'
  | 'unknown';

export interface HealAction {
  action: string;
  description: string;
  retryCount: number;
  maxRetries: number;
  fallbackActivated: boolean;
  coolDownMs: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface SystemHealthSnapshot {
  timestamp: Date;
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: {
    database: boolean;
    redis: boolean;
    aiProviders: { ollama: boolean; gemini: boolean };
    queueSystem: boolean;
    diskSpace: boolean;
    pipelineEngine: boolean;
  };
  activeFailures: number;
  recentHeals: number;
  lastCrash: Date | null;
  uptimeHours: number;
}

const HEAL_RETRY_KEY = 'heal:retry_count';
const HEAL_MAX_RETRIES = 3;
const HEAL_COOLDOWN_KEY = 'heal:cooldown';
const HEAL_COOLDOWN_MS = 60000;
const FAILURE_COUNT_KEY = 'heal:failure_count';
const STUCK_QUEUE_THRESHOLD_MS = 600000;
const MAX_FAILURES_BEFORE_ESCALATION = 5;

export class SelfHealingAI {
  private processStartTime: number = Date.now();
  private healCount: number = 0;
  private lastCrashTime: Date | null = null;

  async heal(failureType: FailureType, context: string, component: string): Promise<HealAction> {
    const retryCount = await this.getRetryCount(component);
    const cooldownActive = await this.isCooldownActive(component);

    if (cooldownActive) {
      return {
        action: 'wait',
        description: `Cooldown active for ${component}. Waiting before retry.`,
        retryCount,
        maxRetries: HEAL_MAX_RETRIES,
        fallbackActivated: false,
        coolDownMs: HEAL_COOLDOWN_MS,
        severity: 'low',
      };
    }

    if (retryCount >= HEAL_MAX_RETRIES) {
      await this.activateCooldown(component, 5);
      await this.recordFailure(component);

      const escalationAction = await this.escalate(failureType, context, component);
      return escalationAction;
    }

    await this.incrementRetry(component);
    this.healCount++;

    const action = await this.determineHealAction(failureType, context, component, retryCount);
    await this.logHealAttempt(failureType, context, component, action.action);

    return action;
  }

  async checkSystemHealth(): Promise<SystemHealthSnapshot> {
    const components = await this.checkAllComponents();
    const activeFailures = await this.getActiveFailureCount();
    const status = this.determineOverallStatus(components);

    return {
      timestamp: new Date(),
      status,
      components,
      activeFailures,
      recentHeals: this.healCount,
      lastCrash: this.lastCrashTime,
      uptimeHours: Math.round((Date.now() - this.processStartTime) / 3600000 * 100) / 100,
    };
  }

  async detectAndFixStuckQueues(): Promise<string[]> {
    const fixed: string[] = [];
    const stuckJobs = await prisma.queueJob.findMany({
      where: {
        status: 'processing',
        startedAt: { lt: new Date(Date.now() - STUCK_QUEUE_THRESHOLD_MS) },
      },
    });

    for (const job of stuckJobs) {
      await prisma.queueJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error: `Auto-heal: Job stuck for >${STUCK_QUEUE_THRESHOLD_MS / 60000}min. Retried ${job.retries}/${job.maxRetries} times.`,
          retries: job.retries + 1,
        },
      });

      if (job.retries < job.maxRetries) {
        await prisma.queueJob.update({
          where: { id: job.id },
          data: {
            status: 'pending',
            error: null,
          },
        });
        fixed.push(`RETRIED ${job.type}:${job.id}`);
        logger.info(`[SelfHealingAI] Retried stuck job ${job.type}:${job.id}`);
      } else {
        fixed.push(`FAILED ${job.type}:${job.id} (max retries exceeded)`);
        logger.warn(`[SelfHealingAI] Marked stuck job as failed ${job.type}:${job.id}`);
      }
    }

    return fixed;
  }

  async detectAndFixCrashedPipelines(): Promise<string[]> {
    const fixed: string[] = [];
    const stuckPipelines = await prisma.videoProject.findMany({
      where: {
        status: { in: ['processing', 'rendering', 'uploading'] },
        updatedAt: { lt: new Date(Date.now() - 3600000) },
      },
    });

    for (const pipeline of stuckPipelines) {
      await prisma.videoProject.update({
        where: { id: pipeline.id },
        data: {
          status: 'failed',
        },
      });

      fixed.push(`FAILED ${pipeline.id} (${pipeline.topic})`);
      logger.warn(`[SelfHealingAI] Crashed pipeline detected: ${pipeline.id} — status set to failed`);
    }

    return fixed;
  }

  async detectAndFixStuckRenders(): Promise<string[]> {
    const fixed: string[] = [];
    const stuckRenders = await prisma.videoRender.findMany({
      where: {
        status: { in: ['pending', 'rendering'] },
        updatedAt: { lt: new Date(Date.now() - 7200000) },
      },
    });

    for (const render of stuckRenders) {
      await prisma.videoRender.update({
        where: { id: render.id },
        data: {
          status: 'failed',
          error: 'Auto-heal: Render stuck for >2 hours',
        },
      });

      await prisma.videoProject.update({
        where: { id: render.projectId },
        data: { status: 'failed' },
      });

      fixed.push(`FAILED render ${render.id} for project ${render.projectId}`);
      logger.warn(`[SelfHealingAI] Stuck render detected: ${render.id}`);
    }

    return fixed;
  }

  async autoRetryFailedJobs(): Promise<{ retried: string[]; failed: string[] }> {
    const retried: string[] = [];
    const failed: string[] = [];

    const failedJobs = await prisma.queueJob.findMany({
      where: {
        status: 'failed',
        retries: { lt: prisma.queueJob.fields ? 999 : 3 },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    for (const job of failedJobs) {
      const maxRetries = job.maxRetries || 3;
      if (job.retries < maxRetries) {
        await prisma.queueJob.update({
          where: { id: job.id },
          data: {
            status: 'pending',
            error: null,
            retries: job.retries + 1,
          },
        });
        retried.push(`RETRIED ${job.type}:${job.id}`);
      } else {
        failed.push(`MAXED ${job.type}:${job.id}`);
      }
    }

    return { retried, failed };
  }

  async switchFallbackProvider(failedProvider: string): Promise<string> {
    const fallback = failedProvider === 'ollama' ? 'gemini' : 'ollama';
    logger.info(`[SelfHealingAI] Switching AI provider from ${failedProvider} to ${fallback}`);

    await prisma.appConfig.upsert({
      where: { key: 'active_ai_provider' },
      update: { value: fallback },
      create: { key: 'active_ai_provider', value: fallback, description: 'Auto-switched by self-healing AI' },
    });

    await redisConnection?.set('ai:provider_fallback', fallback, 'EX', 3600);

    return fallback;
  }

  async restartFailedWorker(workerName: string): Promise<boolean> {
    logger.info(`[SelfHealingAI] Attempting to restart worker: ${workerName}`);

    await redisConnection?.set(`worker:restart:${workerName}`, Date.now().toString(), 'EX', 3600);

    await prisma.appConfig.upsert({
      where: { key: `worker_failed_${workerName}` },
      update: { value: new Date().toISOString() },
      create: {
        key: `worker_failed_${workerName}`,
        value: new Date().toISOString(),
        description: `Auto-detected worker failure for ${workerName}`,
      },
    });

    return true;
  }

  async resetAndRecover(channelId: string): Promise<{ recovered: boolean; actions: string[] }> {
    const actions: string[] = [];

    await redisConnection?.del(`risk:consecutive_failures:${channelId}`);
    await redisConnection?.del(`risk:upload_cooldown:${channelId}`);
    await redisConnection?.del(`risk:low_ctr:${channelId}`);
    await redisConnection?.del(`risk:low_retention:${channelId}`);

    actions.push(`Cleared risk counters for ${channelId}`);

    await prisma.uploadSchedule.updateMany({
      where: { channelId },
      data: { status: 'active' },
    });
    actions.push(`Re-activated upload schedule for ${channelId}`);

    logger.info(`[SelfHealingAI] Recovered channel ${channelId}: ${actions.join(', ')}`);
    return { recovered: true, actions };
  }

  async getFailureReport(): Promise<{
    totalFailures: number;
    failuresByType: Record<string, number>;
    recentFailures: string[];
    healedCount: number;
    recommendation: string;
  }> {
    const failuresByType: Record<string, number> = {};
    let totalFailures = 0;

    for (const type of ['crash', 'pipeline', 'queue', 'api', 'oauth', 'upload', 'ai', 'redis', 'db', 'disk', 'rate']) {
      const count = await this.getFailureCountForType(type);
      if (count > 0) {
        failuresByType[type] = count;
        totalFailures += count;
      }
    }

    const recommendation = this.generateFailureRecommendation(failuresByType);

    return {
      totalFailures,
      failuresByType,
      recentFailures: [],
      healedCount: this.healCount,
      recommendation,
    };
  }

  private async determineHealAction(
    failureType: FailureType,
    context: string,
    component: string,
    retryCount: number
  ): Promise<HealAction> {
    const baseAction: HealAction = {
      action: 'retry',
      description: `Retrying ${component} after ${failureType} failure`,
      retryCount,
      maxRetries: HEAL_MAX_RETRIES,
      fallbackActivated: false,
      coolDownMs: Math.min(30000 * Math.pow(2, retryCount), 600000),
      severity: 'medium',
    };

    switch (failureType) {
      case 'crash':
        return {
          ...baseAction,
          action: 'restart',
          description: `Detected crash in ${component}. Attempting restart.`,
          severity: 'critical',
          coolDownMs: 60000,
        };

      case 'pipeline-step-failed':
        return {
          ...baseAction,
          action: retryCount < 2 ? 'retry-step' : 'skip-step',
          description: retryCount < 2
            ? `Retrying pipeline step ${component}` 
            : `Skipping failed step ${component} after ${retryCount} retries`,
          severity: 'high',
          coolDownMs: 10000 * Math.pow(2, retryCount),
        };

      case 'stuck-queue':
        return {
          ...baseAction,
          action: 'restart-queue-worker',
          description: `Queue ${component} appears stuck. Restarting worker.`,
          severity: 'high',
          coolDownMs: 30000,
        };

      case 'api-timeout':
        return {
          ...baseAction,
          action: 'increase-timeout',
          description: `API timeout on ${component}. Increasing timeout and retrying.`,
          severity: 'medium',
          coolDownMs: 5000 * Math.pow(2, retryCount),
        };

      case 'oauth-failure':
        return {
          ...baseAction,
          action: 'refresh-oauth',
          description: `OAuth failure for ${component}. Attempting token refresh.`,
          severity: 'high',
          coolDownMs: 30000,
        };

      case 'upload-failure':
        return {
          ...baseAction,
          action: retryCount < 2 ? 'retry-upload' : 'abort-upload',
          description: retryCount < 2
            ? `Retrying upload for ${component}`
            : `Aborting upload for ${component} after ${retryCount} failures`,
          severity: 'high',
          coolDownMs: 60000 * Math.pow(2, retryCount),
        };

      case 'ai-provider-down':
        return {
          ...baseAction,
          action: 'switch-ai-provider',
          description: `AI provider ${component} is down. Switching to fallback.`,
          fallbackActivated: true,
          severity: 'high',
          coolDownMs: 10000,
        };

      case 'redis-connection-lost':
        return {
          ...baseAction,
          action: 'reconnect-redis',
          description: 'Redis connection lost. Attempting reconnection.',
          severity: 'critical',
          coolDownMs: 5000 * Math.pow(2, retryCount),
        };

      case 'database-connection-lost':
        return {
          ...baseAction,
          action: 'reconnect-database',
          description: 'Database connection lost. Attempting reconnection.',
          severity: 'critical',
          coolDownMs: 5000 * Math.pow(2, retryCount),
        };

      case 'disk-space-low':
        return {
          ...baseAction,
          action: 'cleanup-disk',
          description: 'Low disk space detected. Triggering cleanup.',
          severity: 'critical',
          coolDownMs: 120000,
        };

      case 'rate-limited':
        return {
          ...baseAction,
          action: 'backoff-retry',
          description: `Rate limited on ${component}. Using exponential backoff.`,
          severity: 'medium',
          coolDownMs: 60000 * Math.pow(2, retryCount),
        };

      default:
        return {
          ...baseAction,
          action: 'generic-retry',
          description: `Unknown failure in ${component}. Performing generic retry.`,
          severity: 'medium',
          coolDownMs: 15000 * Math.pow(2, retryCount),
        };
    }
  }

  private async escalate(failureType: FailureType, context: string, component: string): Promise<HealAction> {
    logger.error(`[SelfHealingAI] Escalating failure: ${failureType} on ${component} — ${context}`);

    await redisConnection?.set(`heal:escalated:${component}`, JSON.stringify({
      failureType,
      context,
      component,
      timestamp: Date.now(),
    }), 'EX', 86400);

    if (failureType === 'oauth-failure') {
      return {
        action: 'disconnect-channel',
        description: `Escalating OAuth failure for ${component}. Disconnecting channel.`,
        retryCount: HEAL_MAX_RETRIES,
        maxRetries: HEAL_MAX_RETRIES,
        fallbackActivated: true,
        coolDownMs: 86400000,
        severity: 'critical',
      };
    }

    if (failureType === 'ai-provider-down') {
      return {
        action: 'switch-all-to-fallback',
        description: 'All AI providers failed. Switching to fully degraded mode.',
        retryCount: HEAL_MAX_RETRIES,
        maxRetries: HEAL_MAX_RETRIES,
        fallbackActivated: true,
        coolDownMs: 3600000,
        severity: 'critical',
      };
    }

    return {
      action: 'stop-and-notify',
      description: `All retries exhausted for ${component}. Stopping operations.`,
      retryCount: HEAL_MAX_RETRIES,
      maxRetries: HEAL_MAX_RETRIES,
      fallbackActivated: false,
      coolDownMs: 3600000,
      severity: 'critical',
    };
  }

  private async checkAllComponents(): Promise<SystemHealthSnapshot['components']> {
    let dbHealthy = false;
    let redisHealthy = false;

    try {
      await prisma.$queryRaw`SELECT 1`;
      dbHealthy = true;
    } catch { dbHealthy = false; }

    try {
      const ping = await redisConnection?.ping();
      redisHealthy = ping === 'PONG';
    } catch { redisHealthy = false; }

    const ollamaHealthy = await this.checkProviderHealth('ollama');
    const geminiHealthy = await this.checkProviderHealth('gemini');

    return {
      database: dbHealthy,
      redis: redisHealthy,
      aiProviders: { ollama: ollamaHealthy, gemini: geminiHealthy },
      queueSystem: await this.checkQueueHealth(),
      diskSpace: await this.checkDiskSpace(),
      pipelineEngine: await this.checkPipelineHealth(),
    };
  }

  private async checkProviderHealth(provider: string): Promise<boolean> {
    const key = `heal:provider_${provider}`;
    const lastFailure = await redisConnection?.get(key);
    if (lastFailure) {
      const elapsed = Date.now() - parseInt(lastFailure);
      return elapsed > 300000;
    }
    return true;
  }

  private async checkQueueHealth(): Promise<boolean> {
    try {
      const stuckCount = await prisma.queueJob.count({
        where: {
          status: 'processing',
          startedAt: { lt: new Date(Date.now() - STUCK_QUEUE_THRESHOLD_MS) },
        },
      });
      return stuckCount < 5;
    } catch {
      return false;
    }
  }

  private async checkDiskSpace(): Promise<boolean> {
    return true;
  }

  private async checkPipelineHealth(): Promise<boolean> {
    try {
      const stuckCount = await prisma.videoProject.count({
        where: {
          status: { in: ['processing', 'rendering', 'uploading'] },
          updatedAt: { lt: new Date(Date.now() - 3600000) },
        },
      });
      return stuckCount < 3;
    } catch {
      return false;
    }
  }

  private determineOverallStatus(components: SystemHealthSnapshot['components']): SystemHealthSnapshot['status'] {
    const all = [
      components.database,
      components.redis,
      components.aiProviders.ollama || components.aiProviders.gemini,
      components.queueSystem,
      components.pipelineEngine,
    ];
    const healthy = all.filter(Boolean).length;
    const total = all.length;

    if (healthy === total) return 'healthy';
    if (healthy >= total * 0.6) return 'degraded';
    return 'unhealthy';
  }

  private async getRetryCount(component: string): Promise<number> {
    const val = await redisConnection?.get(`${HEAL_RETRY_KEY}:${component}`);
    return val ? parseInt(val) : 0;
  }

  private async incrementRetry(component: string): Promise<number> {
    const current = await this.getRetryCount(component);
    const next = current + 1;
    await redisConnection?.set(`${HEAL_RETRY_KEY}:${component}`, next.toString(), 'EX', 3600);
    return next;
  }

  private async isCooldownActive(component: string): Promise<boolean> {
    const val = await redisConnection?.get(`${HEAL_COOLDOWN_KEY}:${component}`);
    return val ? parseInt(val) > Date.now() : false;
  }

  private async activateCooldown(component: string, minutes: number): Promise<void> {
    const until = Date.now() + (minutes * 60000);
    await redisConnection?.set(`${HEAL_COOLDOWN_KEY}:${component}`, until.toString(), 'EX', minutes * 60);
  }

  private async recordFailure(component: string): Promise<void> {
    const key = `${FAILURE_COUNT_KEY}:${component}`;
    const count = await redisConnection?.incr(key);
    if (count === 1) await redisConnection?.expire(key, 86400);
  }

  private async getActiveFailureCount(): Promise<number> {
    const keys = await redisConnection?.keys(`${FAILURE_COUNT_KEY}:*`);
    return keys?.length || 0;
  }

  private async getFailureCountForType(type: string): Promise<number> {
    const val = await redisConnection?.get(`${FAILURE_COUNT_KEY}:${type}`);
    return val ? parseInt(val) : 0;
  }

  private async logHealAttempt(failureType: FailureType, context: string, component: string, action: string): Promise<void> {
    logger.info(`[SelfHealingAI] Heal attempt: ${failureType} on ${component} → ${action} | ${context}`);
  }

  private generateFailureRecommendation(failuresByType: Record<string, number>): string {
    const entries = Object.entries(failuresByType).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return 'No significant failure patterns detected. System is stable.';

    const [topType, topCount] = entries[0];
    if (topCount > 10) {
      return `CRITICAL: ${topType} failures (${topCount} occurrences). System needs immediate review.`;
    }
    if (topCount > 5) {
      return `WARNING: ${topType} failures (${topCount} occurrences). Consider infrastructure changes.`;
    }
    return `MINOR: ${topType} failures (${topCount} occurrences). Monitoring continues.`;
  }
}
