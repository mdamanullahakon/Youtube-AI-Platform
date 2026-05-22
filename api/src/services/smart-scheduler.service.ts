import { logger } from '../utils/logger';
import { WeeklyPerformanceService } from './weekly-performance.service';
import { prisma } from '../config/db';

/**
 * SmartSchedulerService
 * --------------------
 * Uses weekly analytics to compute the optimal upload hour for a given channel.
 * The algorithm is intentionally simple for now – it selects the hour with the highest average CTR
 * across the last 7 days. This can be swapped out for a more sophisticated ML model later.
 *
 * The service is guarded by the `ENABLE_SMART_SCHEDULER` environment variable so the existing
 * UploadSlot‑based scheduler remains untouched if the flag is disabled.
 */
export class SmartSchedulerService {
  private readonly weeklyPerf = new WeeklyPerformanceService();

  constructor() {
    // No‑op – the service is instantiated lazily where needed.
  }

  /**
   * Compute the optimal hour (0‑23) for the given channel based on recent performance.
   * Returns `null` if there is insufficient data or the feature flag is disabled.
   */
  async getOptimalHour(channelId: string): Promise<number | null> {
    if (process.env.ENABLE_SMART_SCHEDULER !== 'true') {
      logger.info('SmartScheduler disabled via ENABLE_SMART_SCHEDULER flag');
      return null;
    }

    // Pull the last 7 days of weekly performance data.
    const data = await this.weeklyPerf.getRecentWeeklyPerformance(channelId);
    if (!data || data.length === 0) {
      logger.warn(`SmartScheduler: No weekly performance data for channel ${channelId}`);
      return null;
    }

    // Aggregate CTR per hour (assuming `hourlyCtr` is a map {hour: number} on each record).
    const hourBuckets: Record<number, { sum: number; count: number }> = {};
    for (const record of data) {
      // Expected shape: { hourStats: { [hour: string]: number } }
      const hourStats = (record as any).hourStats || {};
      for (const [hourStr, ctr] of Object.entries(hourStats)) {
        const hour = Number(hourStr);
        if (Number.isNaN(hour) || hour < 0 || hour > 23) continue;
        if (!hourBuckets[hour]) hourBuckets[hour] = { sum: 0, count: 0 };
        hourBuckets[hour].sum += ctr as number;
        hourBuckets[hour].count += 1;
      }
    }

    // Compute average CTR per hour and pick the best.
    let bestHour: number | null = null;
    let bestAvg = -Infinity;
    for (const [hourStr, bucket] of Object.entries(hourBuckets)) {
      const avg = bucket.sum / bucket.count;
      if (avg > bestAvg) {
        bestAvg = avg;
        bestHour = Number(hourStr);
      }
    }

    logger.info('SmartScheduler: optimal hour calculated', { channelId, bestHour, bestAvg });
    return bestHour;
  }

  /**
   * Schedule the next upload for a video project based on the optimal hour.
   * This method does **not** replace the existing UploadSlot scheduler – it simply
   * creates a one‑off cron entry for the calculated time if the flag is enabled.
   */
  async scheduleNextUpload(projectId: string, channelId: string): Promise<void> {
    const optimalHour = await this.getOptimalHour(channelId);
    if (optimalHour === null) {
      logger.info('SmartScheduler: falling back to default upload slot');
      return; // Let the existing UploadScheduler handle it.
    }

    // Build a cron expression for the chosen hour (run at minute 0).
    const cronExpr = `0 ${optimalHour} * * *`;
    // Use the existing scheduler infrastructure – we add a temporary job.
    // For simplicity we push a job into the videoQueue with a delay approximating the next occurrence.
    // In production this would be a proper cron registration.
    const now = new Date();
    const next = new Date();
    next.setHours(optimalHour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delayMs = next.getTime() - now.getTime();

    const { videoQueue } = await import('../queues/video.queue');
    await videoQueue.add('full-pipeline', { projectId, channelId }, { delay: delayMs, attempts: 3 });
    logger.info('SmartScheduler: queued project for optimal upload time', { projectId, channelId, cronExpr, delayMs });
  }
}
