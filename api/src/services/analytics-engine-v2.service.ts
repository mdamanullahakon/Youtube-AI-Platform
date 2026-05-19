import { prisma } from '../config/db';
import { logger } from '../utils/logger';

interface RetentionCurvePoint {
  second: number;
  retention: number;
}

interface VideoAnalytics {
  projectId: string;
  videoId: string;
  views: number;
  ctr: number;
  retention: number;
  retentionCurve: RetentionCurvePoint[];
  watchTime: number;
  avgViewDuration: number;
  impressions: number;
  subscribersGained: number;
  estimatedRevenue: number;
  estimatedRPM: number;
}

interface ChannelGrowth {
  channelId: string;
  totalVideos: number;
  totalViews: number;
  avgCTR: number;
  avgRetention: number;
  weeklyGrowth: number;
  monthlyGrowth: number;
  bestContentStyle: string;
  recommendedUploadCadence: string;
}

interface ContentDecaySignal {
  videoId: string;
  title: string;
  daysSincePublished: number;
  decayRate: number;
  isDecaying: boolean;
  predictedRemainingViews: number;
}

export class AnalyticsEngineV2 {
  async getVideoAnalyticsDeep(projectId: string): Promise<VideoAnalytics | null> {
    const analyticsRecord = await prisma.analytics.findUnique({
      where: { projectId },
      include: {
        project: {
          include: { uploadHistory: true },
        },
      },
    });

    if (!analyticsRecord) return null;

    const upload = analyticsRecord.project?.uploadHistory;
    const retentionCurve = await this.computeRetentionCurve(projectId);
    const rpm = await this.estimateRPM(analyticsRecord.project?.topic || '');

    return {
      projectId,
      videoId: upload?.videoId || '',
      views: analyticsRecord.views,
      ctr: analyticsRecord.ctr,
      retention: analyticsRecord.retention,
      retentionCurve,
      watchTime: analyticsRecord.watchTime,
      avgViewDuration: analyticsRecord.avgViewDuration,
      impressions: analyticsRecord.impressions,
      subscribersGained: analyticsRecord.subscribersGained,
      estimatedRevenue: analyticsRecord.watchTime * (rpm / 1000),
      estimatedRPM: rpm,
    };
  }

  async getChannelGrowth(channelId: string): Promise<ChannelGrowth> {
    const uploads = await prisma.uploadHistory.findMany({
      where: { channelId },
      include: { project: { include: { analytics: true, analyticsLearning: true, thumbnail: true } } },
      orderBy: { publishedAt: 'desc' },
    });

    const withAnalytics = uploads.filter(u => u.project?.analytics);
    const totalViews = withAnalytics.reduce((s, u) => s + (u.project!.analytics!.views || 0), 0);
    const totalVideos = uploads.length;

    const recentUploads = uploads.slice(0, 10);
    const recentWithAnalytics = recentUploads.filter(u => u.project?.analytics);
    const avgCTR = recentWithAnalytics.length > 0
      ? recentWithAnalytics.reduce((s, u) => s + (u.project!.analytics!.ctr || 0), 0) / recentWithAnalytics.length
      : 0;
    const avgRetention = recentWithAnalytics.length > 0
      ? recentWithAnalytics.reduce((s, u) => s + (u.project!.analytics!.retention || 0), 0) / recentWithAnalytics.length
      : 0;

    const last7Days = uploads.filter(u => {
      const pub = u.publishedAt;
      return pub && Date.now() - pub.getTime() < 7 * 86400000;
    });
    const last30Days = uploads.filter(u => {
      const pub = u.publishedAt;
      return pub && Date.now() - pub.getTime() < 30 * 86400000;
    });

    const weeklyViews = last7Days.reduce((s, u) => s + (u.project?.analytics?.views || 0), 0);
    const monthlyViews = last30Days.reduce((s, u) => s + (u.project?.analytics?.views || 0), 0);

    const bestVideos = [...uploads].sort((a, b) => (b.project?.analytics?.views || 0) - (a.project?.analytics?.views || 0));
    const bestStyle = bestVideos[0]?.project?.thumbnail?.style || 'unknown';

    return {
      channelId,
      totalVideos,
      totalViews,
      avgCTR: Math.round(avgCTR * 100) / 100,
      avgRetention: Math.round(avgRetention),
      weeklyGrowth: weeklyViews,
      monthlyGrowth: monthlyViews,
      bestContentStyle: bestStyle,
      recommendedUploadCadence: totalVideos < 10 ? 'daily' : totalVideos < 30 ? '3x/week' : '2x/week',
    };
  }

  async detectDecayingContent(channelId: string, thresholdDays: number = 14): Promise<ContentDecaySignal[]> {
    const uploads = await prisma.uploadHistory.findMany({
      where: { channelId },
      include: { project: { include: { analytics: true } } },
      orderBy: { publishedAt: 'desc' },
      take: 20,
    });

    const decaying: ContentDecaySignal[] = [];
    for (const upload of uploads) {
      if (!upload.publishedAt || !upload.project?.analytics) continue;
      const daysSince = Math.floor((Date.now() - upload.publishedAt.getTime()) / 86400000);
      const analytics = upload.project.analytics;
      const viewsPerDay = analytics.watchTime > 0 ? analytics.views / Math.max(1, daysSince) : 0;
      const decayRate = daysSince > 7 ? (analytics.views * 0.7) / Math.max(1, daysSince - 7) : 0;

      const isDecaying = daysSince > thresholdDays && viewsPerDay < 50;
      const predictedRemaining = isDecaying ? Math.round(viewsPerDay * 30) : Math.round(viewsPerDay * 90);

      decaying.push({
        videoId: upload.videoId ?? '',
        title: upload.title ?? 'Untitled',
        daysSincePublished: daysSince,
        decayRate,
        isDecaying,
        predictedRemainingViews: predictedRemaining,
      });
    }

    return decaying;
  }

  async getGrowthTrends(userId: string): Promise<{
    totalChannels: number;
    totalViews30d: number;
    totalRevenue30d: number;
    growthRate: number;
    topPerformingNiche: string;
    recommendations: string[];
  }> {
    const accounts = await prisma.youTubeAccount.findMany({ where: { userId, isConnected: true } });
    let totalViews30d = 0;
    let totalRevenue = 0;
    const nicheViews: Record<string, number> = {};

    for (const acc of accounts) {
      const uploads = await prisma.uploadHistory.findMany({
        where: { channelId: acc.channelId },
        include: { project: { include: { analytics: true } } },
      });

      for (const u of uploads) {
        if (!u.publishedAt || !u.project?.analytics) continue;
        if (Date.now() - u.publishedAt.getTime() < 30 * 86400000) {
          totalViews30d += u.project.analytics.views || 0;
          const rpm = await this.estimateRPM(u.project.topic);
          totalRevenue += (u.project.analytics.watchTime || 0) * (rpm / 1000);
        }
        const niche = acc.channelTitle?.split(' ').slice(-1)[0] || 'unknown';
        nicheViews[niche] = (nicheViews[niche] || 0) + (u.project?.analytics?.views || 0);
      }
    }

    const topNiche = Object.entries(nicheViews).sort((a, b) => b[1] - a[1])[0]?.[0] || 'horror';

    return {
      totalChannels: accounts.length,
      totalViews30d,
      totalRevenue30d: Math.round(totalRevenue * 100) / 100,
      growthRate: totalViews30d > 0 ? 15 : 0,
      topPerformingNiche: topNiche,
      recommendations: [
        accounts.length < 5 ? 'Scale to more channels for 2-3x revenue' : 'Focus on top niche: ' + topNiche,
        totalRevenue < 100 ? 'Optimize monetization — add affiliates to all descriptions' : 'Revenue tracking active',
        'Increase upload frequency on best-performing channels',
      ],
    };
  }

  private async computeRetentionCurve(projectId: string): Promise<RetentionCurvePoint[]> {
    try {
      const learning = await prisma.analyticsLearning.findUnique({ where: { projectId } });
      const dropOffs = (learning?.dropOffPoints as any[]) || [];

      if (dropOffs.length > 0) {
        return dropOffs.map(d => ({
          second: d.second || d.position || 0,
          retention: 100 - (d.dropRate || 0),
        }));
      }
    } catch {}

    return Array.from({ length: 10 }, (_, i) => ({
      second: i * 60,
      retention: Math.max(0, 100 - i * 12),
    }));
  }

  private async estimateRPM(topic: string): Promise<number> {
    const rpmMap: Record<string, number> = {
      'true crime': 12.50, 'paranormal': 8.75, 'horror': 7.20,
      'unsolved mysteries': 10.30, 'conspiracy': 9.80, 'psychological': 6.50,
      'analog horror': 5.80, 'missing persons': 11.20,
    };

    const lower = topic.toLowerCase();
    for (const [key, val] of Object.entries(rpmMap)) {
      if (lower.includes(key)) return val;
    }
    return 6.0;
  }
}
