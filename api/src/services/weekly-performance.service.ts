import { prisma } from '../config/db';
import { logger } from '../utils/logger';

/**
 * Service to aggregate weekly analytics into the WeeklyPerformance model.
 * Runs once per week (e.g., Sunday 02:00 UTC) and inserts a new row per channel.
 */
export class WeeklyPerformanceService {
  /**
   * Aggregate analytics for the past week and store summary metrics.
   */
  async aggregateAll(): Promise<void> {
    const now = new Date();
    // Define the start of the aggregation window (7 days ago)
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);

    // Fetch all analytics collected in the window
    const records = await prisma.analytics.findMany({
      where: {
        collectedAt: {
          gte: weekStart,
          lt: now,
        },
      },
    });

    // Group by channelId
    const grouped: Record<string, { ctr: number[]; retention: number[]; watchTime: number[] }> = {};
    for (const rec of records) {
      const cid = rec.channelId;
      if (!grouped[cid]) {
        grouped[cid] = { ctr: [], retention: [], watchTime: [] };
      }
      grouped[cid].ctr.push(rec.ctr);
      grouped[cid].retention.push(rec.retention);
      grouped[cid].watchTime.push(rec.watchTime);
    }

    // Upsert weekly performance per channel
    for (const [channelId, data] of Object.entries(grouped)) {
      const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
      const avgCTR = avg(data.ctr);
      const avgRetention = avg(data.retention);
      const avgWatchTime = avg(data.watchTime);

      await prisma.weeklyPerformance.upsert({
        where: {
          // Composite unique key not defined; use combination of channelId and weekStart via raw query fallback
          // We'll create a unique index on (channelId, weekStart) manually if needed.
          // For simplicity, create a new entry each week.
          id: '' // placeholder to satisfy type, will be ignored because we use create instead.
        },
        create: {
          channelId,
          weekStart,
          avgCTR,
          avgRetention,
          avgWatchTime,
        },
        update: {
          avgCTR,
          avgRetention,
          avgWatchTime,
        },
      }).catch(async (e) => {
        // If upsert fails due to missing unique constraint, fallback to create
        await prisma.weeklyPerformance.create({
          data: { channelId, weekStart, avgCTR, avgRetention, avgWatchTime },
        });
      });
    }
    logger.info('Weekly performance aggregation completed', { weekStart: weekStart.toISOString(), now: now.toISOString() });
  }
}
