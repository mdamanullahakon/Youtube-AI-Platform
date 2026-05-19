import { prisma } from '../config/db';
import { logger } from '../utils/logger';

export interface MonetizationReport {
  channelId: string;
  estimatedRPM: number;
  estimatedCPM: number;
  estimatedEarnings: number;
  monthlyViews: number;
  monthlyWatchHours: number;
  subscriberGrowth: number;
  returningViewerPct: number;
  avgCTR: number;
  avgRetention: number;
  topNiche: string | null;
  bestUploadTime: string | null;
  growthVelocity: 'declining' | 'stagnant' | 'growing' | 'accelerating';
  revenueProjection: {
    conservative: number;
    moderate: number;
    optimistic: number;
  };
}

export class MonetizationService {
  async generateReport(channelId: string): Promise<MonetizationReport | null> {
    logger.info(`Generating monetization report for channel: ${channelId}`);

    const channel = await prisma.youTubeAccount.findFirst({ where: { channelId } });
    if (!channel) return null;

    const projects = await prisma.videoProject.findMany({
      where: { userId: channel.userId },
      include: { analytics: true, uploadHistory: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const published = projects.filter(p => p.uploadHistory?.status === 'published');
    const withAnalytics = published.filter(p => p.analytics);

    if (published.length === 0) {
      const empty: MonetizationReport = {
        channelId,
        estimatedRPM: 0, estimatedCPM: 0, estimatedEarnings: 0,
        monthlyViews: 0, monthlyWatchHours: 0, subscriberGrowth: 0,
        returningViewerPct: 0, avgCTR: 0, avgRetention: 0,
        topNiche: null, bestUploadTime: null, growthVelocity: 'stagnant',
        revenueProjection: { conservative: 0, moderate: 0, optimistic: 0 },
      };
      return empty;
    }

    const totalViews = withAnalytics.reduce((s, p) => s + (p.analytics?.views || 0), 0);
    const totalWatchTime = withAnalytics.reduce((s, p) => s + (p.analytics?.watchTime || 0), 0);
    const totalSubs = withAnalytics.reduce((s, p) => s + (p.analytics?.subscribersGained || 0), 0);
    const avgCTR = withAnalytics.length > 0
      ? withAnalytics.reduce((s, p) => s + (p.analytics?.ctr || 0), 0) / withAnalytics.length
      : 0;
    const avgRetention = withAnalytics.length > 0
      ? withAnalytics.reduce((s, p) => s + (p.analytics?.retention || 0), 0) / withAnalytics.length
      : 0;

    const nicheFrequency: Record<string, number> = {};
    published.forEach(p => {
      const topic = p.topic || 'General';
      nicheFrequency[topic] = (nicheFrequency[topic] || 0) + 1;
    });
    const topNiche = Object.entries(nicheFrequency).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const monthlyViews = Math.round(totalViews / Math.max(1, published.length / 30));
    const monthlyWatchHours = totalWatchTime / 3600 / Math.max(1, published.length / 30);

    const rpm = this.estimateRPM(topNiche || 'General');
    const cpm = rpm * 1.2;
    const estimatedEarnings = (monthlyViews / 1000) * rpm;

    const growth = totalSubs / Math.max(1, published.length);
    let growthVelocity: 'declining' | 'stagnant' | 'growing' | 'accelerating' = 'stagnant';
    if (growth > 50) growthVelocity = 'accelerating';
    else if (growth > 20) growthVelocity = 'growing';
    else if (growth < 5) growthVelocity = 'declining';

    const existing = await prisma.channelMetrics.findFirst({
      where: { channelId },
      orderBy: { collectedAt: 'desc' },
    });

    await prisma.channelMetrics.create({
      data: {
        channelId,
        userId: channel.userId,
        subscribers: 0,
        totalViews,
        totalVideos: published.length,
        estimatedRPM: rpm,
        estimatedCPM: cpm,
        estimatedEarnings,
        monthlyViews,
        monthlyWatchHours,
        subscriberGrowth: totalSubs,
        returningViewerPct: 30,
        avgCTR,
        avgRetention,
        topNiche,
        metadata: { growthVelocity, projectCount: published.length, analyzedAt: new Date().toISOString() },
      },
    });

    return {
      channelId,
      estimatedRPM: rpm,
      estimatedCPM: cpm,
      estimatedEarnings,
      monthlyViews,
      monthlyWatchHours,
      subscriberGrowth: totalSubs,
      returningViewerPct: 30,
      avgCTR,
      avgRetention,
      topNiche,
      bestUploadTime: existing?.bestUploadTime || null,
      growthVelocity,
      revenueProjection: {
        conservative: estimatedEarnings * 0.7,
        moderate: estimatedEarnings,
        optimistic: estimatedEarnings * 1.5,
      },
    };
  }

  private estimateRPM(niche: string): number {
    const rpmMap: Record<string, number> = {
      'AI News': 8, 'Tech Facts': 6, 'Business Stories': 12, 'Motivation': 4,
      'Celebrity Stories': 7, 'Horror': 5, 'True Crime': 10, 'Finance': 15,
      'Gaming': 3, 'Education': 8, 'Entertainment': 4, 'Music': 2,
      'Sports': 5, 'News': 6, 'Howto': 9, 'Science': 7,
    };
    for (const [key, rpm] of Object.entries(rpmMap)) {
      if (niche.toLowerCase().includes(key.toLowerCase())) return rpm;
    }
    return 5;
  }

  async getEarningsByChannel(userId: string) {
    const channels = await prisma.youTubeAccount.findMany({
      where: { userId, isConnected: true },
    });

    const reports = await Promise.all(
      channels.map(c => this.generateReport(c.channelId))
    );

    return reports.filter(Boolean);
  }
}
