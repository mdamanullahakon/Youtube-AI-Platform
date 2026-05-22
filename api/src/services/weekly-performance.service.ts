import { prisma } from '../config/db';
import { logger } from '../utils/logger';

/**
 * Service to aggregate weekly analytics into the WeeklyPerformance model.
 * Runs once per week (e.g., Sunday 02:00 UTC) and inserts a new row per channel.
 */
export class WeeklyPerformanceService {
  /**
   * Retrieve recent weekly performance records for a specific channel.
   * Used by SmartSchedulerService to compute optimal upload times.
   */
  async getRecentWeeklyPerformance(channelId: string, limit: number = 7): Promise<any[]> {
    return prisma.weeklyPerformance.findMany({
      where: { channelId },
      orderBy: { weekStart: 'desc' },
      take: limit,
    });
  }

  /**
   * Aggregate analytics for the past week and store summary metrics.
   */
  async aggregateAll(): Promise<void> {
    const now = new Date();
    // Define the start of the aggregation window (7 days ago)
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);

    // Fetch all analytics collected in the window, including the project to get channelId
    const records = await prisma.analytics.findMany({
      where: {
        collectedAt: {
          gte: weekStart,
          lt: now,
        },
      },
      include: {
        project: {
          select: { channelId: true },
        },
      },
    });

    // Group by channelId (from the related project)
    const grouped: Record<string, { ctr: number[]; retention: number[]; watchTime: number[] }> = {};
    for (const rec of records) {
      const cid = rec.project?.channelId;
      if (!cid) continue; // skip records without a channel
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

      // Use findFirst + update/create pattern since there's only a composite index, not a unique constraint
      const existing = await prisma.weeklyPerformance.findFirst({
        where: { channelId, weekStart },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        await prisma.weeklyPerformance.update({
          where: { id: existing.id },
          data: { avgCTR, avgRetention, avgWatchTime },
        });
      } else {
        await prisma.weeklyPerformance.create({
          data: { channelId, weekStart, avgCTR, avgRetention, avgWatchTime },
        });
      }
    }
    logger.info('Weekly performance aggregation completed', { weekStart: weekStart.toISOString(), now: now.toISOString() });
  }
}
