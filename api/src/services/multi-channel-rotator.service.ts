import { prisma } from '../config/db';
import { logger } from '../utils/logger';

interface ChannelPerformance {
  channelId: string;
  channelTitle: string;
  totalUploads: number;
  avgViews: number;
  avgCtr: number;
  avgRetention: number;
  totalRevenue: number;
  lastUploadAt: Date | null;
  score: number;
}

export class MultiChannelRotator {
  async selectBestChannel(userId: string): Promise<{ channelId: string; accountId: string } | null> {
    const accounts = await prisma.youTubeAccount.findMany({
      where: { userId, isConnected: true },
    });

    if (accounts.length === 0) return null;
    if (accounts.length === 1) {
      return { channelId: accounts[0].channelId, accountId: accounts[0].id };
    }

    const performances: ChannelPerformance[] = [];
    for (const acc of accounts) {
      const uploads = await prisma.uploadHistory.findMany({
        where: { channelId: acc.channelId, userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const projectIds = uploads.filter(u => u.projectId).map(u => u.projectId);
      const analyticsRecords = await prisma.analytics.findMany({
        where: { projectId: { in: projectIds } },
      });
      const analyticsMap = new Map(analyticsRecords.map(a => [a.projectId, a]));

      const withAnalytics = uploads.filter(u => analyticsMap.has(u.projectId));
      const avgViews = withAnalytics.length > 0
        ? withAnalytics.reduce((s, u) => s + (analyticsMap.get(u.projectId)?.views || 0), 0) / withAnalytics.length
        : 0;
      const avgCtr = withAnalytics.length > 0
        ? withAnalytics.reduce((s, u) => s + (analyticsMap.get(u.projectId)?.ctr || 0), 0) / withAnalytics.length
        : 0;
      const totalViews = withAnalytics.reduce((s, u) => s + (analyticsMap.get(u.projectId)?.views || 0), 0);
      const nicheRpm = 3.5;
      const totalRevenue = totalViews * (nicheRpm / 1000);
      const lastUpload = uploads.length > 0 ? uploads[0].createdAt : null;
      const daysSinceLastUpload = lastUpload
        ? (Date.now() - lastUpload.getTime()) / 86400000
        : 999;

      const score =
        avgViews * 0.3 +
        avgCtr * 10 * 0.25 +
        Math.min(daysSinceLastUpload / 7, 1) * 100 * 0.25 +
        totalRevenue * 0.2;

      performances.push({
        channelId: acc.channelId,
        channelTitle: acc.channelTitle || 'Unknown',
        totalUploads: uploads.length,
        avgViews,
        avgCtr,
        avgRetention: 0,
        totalRevenue,
        lastUploadAt: lastUpload,
        score,
      });
    }

    performances.sort((a, b) => b.score - a.score);
    const best = performances[0];
    const bestAccount = accounts.find(a => a.channelId === best.channelId);

    logger.info(`[ChannelRotator] Selected: ${best.channelTitle} (score: ${best.score.toFixed(1)})`);

    return { channelId: best.channelId, accountId: bestAccount?.id || best.channelId };
  }

  async getChannelStats(userId: string): Promise<ChannelPerformance[]> {
    const accounts = await prisma.youTubeAccount.findMany({
      where: { userId, isConnected: true },
    });

    const performances: ChannelPerformance[] = [];
    for (const acc of accounts) {
      const uploads = await prisma.uploadHistory.findMany({
        where: { channelId: acc.channelId, userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const projectIds = uploads.filter(u => u.projectId).map(u => u.projectId);
      const analyticsRecords = await prisma.analytics.findMany({
        where: { projectId: { in: projectIds } },
      });
      const analyticsMap = new Map(analyticsRecords.map(a => [a.projectId, a]));

      const withAnalytics = uploads.filter(u => analyticsMap.has(u.projectId));
      const avgViews = withAnalytics.length > 0
        ? withAnalytics.reduce((s, u) => s + (analyticsMap.get(u.projectId)?.views || 0), 0) / withAnalytics.length
        : 0;
      const avgCtr = withAnalytics.length > 0
        ? withAnalytics.reduce((s, u) => s + (analyticsMap.get(u.projectId)?.ctr || 0), 0) / withAnalytics.length
        : 0;
      const totalViews = withAnalytics.reduce((s, u) => s + (analyticsMap.get(u.projectId)?.views || 0), 0);
      const nicheRpm = 3.5;
      const totalRevenue = totalViews * (nicheRpm / 1000);
      const lastUpload = uploads.length > 0 ? uploads[0].createdAt : null;
      const daysSinceLastUpload = lastUpload
        ? (Date.now() - lastUpload.getTime()) / 86400000
        : 999;

      const score =
        avgViews * 0.3 +
        avgCtr * 10 * 0.25 +
        Math.min(daysSinceLastUpload / 7, 1) * 100 * 0.25 +
        totalRevenue * 0.2;

      performances.push({
        channelId: acc.channelId,
        channelTitle: acc.channelTitle || 'Unknown',
        totalUploads: uploads.length,
        avgViews,
        avgCtr,
        avgRetention: 0,
        totalRevenue,
        lastUploadAt: lastUpload,
        score,
      });
    }

    return performances;
  }
}
