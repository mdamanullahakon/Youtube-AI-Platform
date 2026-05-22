import { logger } from '../config/logger';
import { prisma } from '../config/db';
import { videoQueue } from '../queues/video.queue';

/**
 * SeriesIntelligenceService
 * -------------------------
 * Provides analytics across a series of video projects (e.g., episodic content).
 * Currently computes simple retention trends and suggests optimal upload timing.
 * The service is gated by the `ENABLE_SERIES_INTELLIGENCE` env flag.
 */
export class SeriesIntelligenceService {
  constructor() {
    // No initialization needed.
  }

  /**
   * Compute basic series performance metrics.
   * Returns null if insufficient data or feature disabled.
   */
  async computeSeriesMetrics(seriesId: string): Promise<{ averageRetention: number } | null> {
    if (process.env.ENABLE_SERIES_INTELLIGENCE !== 'true') {
      logger.info('SeriesIntelligence disabled via ENABLE_SERIES_INTELLIGENCE flag');
      return null;
    }
    // Fetch recent video projects belonging to the series.
    const projects = await prisma.videoProject.findMany({
      where: { seriesId },
      select: { id: true },
    });
    if (!projects.length) {
      logger.warn(`SeriesIntelligence: No projects found for series ${seriesId}`);
      return null;
    }
    // Placeholder: compute average retention from analytics table.
    const retentionRecords = await prisma.weeklyPerformance.findMany({
      where: { projectId: { in: projects.map(p => p.id) } },
      select: { retentionRate: true },
    });
    if (!retentionRecords.length) return null;
    const total = retentionRecords.reduce((sum, r) => sum + (r.retentionRate ?? 0), 0);
    const averageRetention = total / retentionRecords.length;
    return { averageRetention };
  }

  /**
   * Schedule the next upload for a series based on computed metrics.
   */
  async scheduleSeriesUpload(seriesId: string, channelId: string, projectId: string): Promise<void> {
    const metrics = await this.computeSeriesMetrics(seriesId);
    if (!metrics) {
      logger.info('SeriesIntelligence: falling back to default scheduler');
      return;
    }
    // Simple heuristic: if average retention > 0.6, prioritize early morning upload.
    const optimalHour = metrics.averageRetention > 0.6 ? 6 : 18;
    const now = new Date();
    const next = new Date();
    next.setHours(optimalHour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delayMs = next.getTime() - now.getTime();
    await videoQueue.add('full-pipeline', { projectId, channelId }, { delay: delayMs, attempts: 3 });
    logger.info('SeriesIntelligence: queued series project for optimal time', { seriesId, projectId, optimalHour });
  }
}
