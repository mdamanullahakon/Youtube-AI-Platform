import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { MonetizationAnalytics, MonetizationMetrics, ChannelMonetizationReport } from './monetization-analytics.service';

export interface RevenueBasedChannelScore {
  channelId: string;
  channelTitle: string;
  revenueScore: number;
  totalRevenue: number;
  totalProfit: number;
  avgProfitMargin: number;
  revenuePerView: number;
  avgRPM: number;
  conversionRate: number;
  velocity: 'accelerating' | 'growing' | 'stagnant' | 'declining' | 'critical';
  recommendedAction: 'scale-up' | 'maintain' | 'reduce' | 'kill';
}

export class RevenueBasedScaler {
  private monetizationAnalytics: MonetizationAnalytics;

  private readonly SCALE_UP_THRESHOLD = 100;
  private readonly MAINTAIN_THRESHOLD = 30;
  private readonly REDUCE_THRESHOLD = 10;
  private readonly KILL_THRESHOLD = 0;

  constructor() {
    this.monetizationAnalytics = new MonetizationAnalytics();
  }

  async evaluateChannelByRevenue(channelId: string): Promise<RevenueBasedChannelScore | null> {
    const channel = await prisma.youTubeAccount.findFirst({ where: { channelId } });
    if (!channel) return null;

    const report = await this.monetizationAnalytics.computeChannelMonetization(channelId);
    if (!report || report.totalVideos === 0) {
      return {
        channelId, channelTitle: channel.channelTitle || '',
        revenueScore: 0, totalRevenue: 0, totalProfit: 0,
        avgProfitMargin: 0, revenuePerView: 0, avgRPM: 0,
        conversionRate: 0, velocity: 'stagnant',
        recommendedAction: 'maintain',
      };
    }

    const revenueScore = Math.round(
      report.totalProfit * 0.35 +
      report.avgProfitMargin * 0.25 +
      report.avgRevenuePerView * 1000 * 0.20 +
      report.totalAdRevenue * 0.10 +
      report.totalAffiliateRevenue * 2 * 0.10
    );

    const recentProjects = await prisma.videoProject.findMany({
      where: { channelId, uploadHistory: { status: 'published' } },
      include: { analytics: true, monetizationConversion: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const recentRevenue = await this.calculateRecentRevenue(recentProjects);
    const olderProjects = await prisma.videoProject.findMany({
      where: { channelId, uploadHistory: { status: 'published' } },
      include: { analytics: true },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    const olderRevenue = await this.calculateRecentRevenue(olderProjects);

    let velocity: RevenueBasedChannelScore['velocity'] = 'stagnant';
    if (recentRevenue > olderRevenue * 1.5 && olderRevenue > 0) velocity = 'accelerating';
    else if (recentRevenue > olderRevenue * 1.1) velocity = 'growing';
    else if (recentRevenue < olderRevenue * 0.7) velocity = 'declining';
    else if (recentRevenue < olderRevenue * 0.3 || report.totalProfit < -10) velocity = 'critical';

    let recommendedAction: RevenueBasedChannelScore['recommendedAction'];
    if (revenueScore >= this.SCALE_UP_THRESHOLD || (velocity === 'accelerating' && report.totalProfit > 50)) {
      recommendedAction = 'scale-up';
    } else if (revenueScore >= this.MAINTAIN_THRESHOLD) {
      recommendedAction = 'maintain';
    } else if (revenueScore >= this.REDUCE_THRESHOLD) {
      recommendedAction = 'reduce';
    } else {
      recommendedAction = 'kill';
    }

    logger.info(`[RevenueScaler] ${channel.channelTitle}: revenueScore=${revenueScore}, profit=$${report.totalProfit}, action=${recommendedAction}`);

    return {
      channelId, channelTitle: channel.channelTitle || '',
      revenueScore, totalRevenue: report.totalRevenue, totalProfit: report.totalProfit,
      avgProfitMargin: report.avgProfitMargin, revenuePerView: report.avgRevenuePerView,
      avgRPM: report.totalViews > 0 ? (report.totalRevenue / report.totalViews) * 1000 : 0,
      conversionRate: report.avgProfitMargin,
      velocity, recommendedAction,
    };
  }

  async evaluateAllChannelsByRevenue(): Promise<RevenueBasedChannelScore[]> {
    const channels = await prisma.youTubeAccount.findMany({ where: { isConnected: true } });
    const results = await Promise.all(
      channels.map(c => this.evaluateChannelByRevenue(c.channelId))
    );
    return results.filter((r): r is RevenueBasedChannelScore => r !== null);
  }

  async executeRevenueScaling(dryRun = true): Promise<{
    scaledUp: { channelTitle: string; revenueScore: number }[];
    maintained: { channelTitle: string; revenueScore: number }[];
    reduced: { channelTitle: string; revenueScore: number }[];
    killed: { channelTitle: string; revenueScore: number }[];
    totalProjectedSavings: number;
  }> {
    const evaluations = await this.evaluateAllChannelsByRevenue();
    const scaledUp: { channelTitle: string; revenueScore: number }[] = [];
    const maintained: { channelTitle: string; revenueScore: number }[] = [];
    const reduced: { channelTitle: string; revenueScore: number }[] = [];
    const killed: { channelTitle: string; revenueScore: number }[] = [];

    for (const evalResult of evaluations) {
      switch (evalResult.recommendedAction) {
        case 'scale-up':
          if (!dryRun) {
            await prisma.uploadSchedule.updateMany({
              where: { channelId: evalResult.channelId, status: 'active' },
              data: { frequency: 'daily' },
            });
          }
          scaledUp.push({ channelTitle: evalResult.channelTitle, revenueScore: evalResult.revenueScore });
          break;

        case 'maintain':
          maintained.push({ channelTitle: evalResult.channelTitle, revenueScore: evalResult.revenueScore });
          break;

        case 'reduce':
          if (!dryRun) {
            await prisma.uploadSchedule.updateMany({
              where: { channelId: evalResult.channelId, status: 'active' },
              data: { frequency: 'weekly' },
            });
          }
          reduced.push({ channelTitle: evalResult.channelTitle, revenueScore: evalResult.revenueScore });
          break;

        case 'kill':
          if (!dryRun) {
            await prisma.youTubeAccount.update({
              where: {
                userId_channelId: { userId: (await prisma.youTubeAccount.findFirst({ where: { channelId: evalResult.channelId } }))?.userId || '', channelId: evalResult.channelId },
              },
              data: { isConnected: false },
            });
            await prisma.uploadSchedule.updateMany({
              where: { channelId: evalResult.channelId },
              data: { status: 'paused' },
            });
            logger.warn(`[RevenueScaler] KILLED channel ${evalResult.channelTitle} (revenueScore: ${evalResult.revenueScore})`);
          }
          killed.push({ channelTitle: evalResult.channelTitle, revenueScore: evalResult.revenueScore });
          break;
      }
    }

    const totalProjectedSavings = killed.reduce((s, k) => s + Math.abs(k.revenueScore) * 10, 0);
    const prefix = dryRun ? '[DRY RUN] ' : '';

    logger.info(`${prefix}Revenue scaling: ${scaledUp.length} scale-up, ${maintained.length} maintain, ${reduced.length} reduce, ${killed.length} kill`);

    return { scaledUp, maintained, reduced, killed, totalProjectedSavings };
  }

  async getTopProfitNiches(limit = 5): Promise<{ niche: string; totalProfit: number; avgMargin: number; channels: number }[]> {
    const channels = await prisma.youTubeAccount.findMany({ where: { isConnected: true } });
    const nicheMap = new Map<string, { profit: number; margin: number; channelCount: number }>();

    for (const channel of channels) {
      const evalResult = await this.evaluateChannelByRevenue(channel.channelId);
      if (!evalResult || evalResult.totalProfit <= 0) continue;

      const niche = (await prisma.contentStrategy.findFirst({
        where: { channelId: channel.channelId },
      }))?.niche || 'General';

      const existing = nicheMap.get(niche) || { profit: 0, margin: 0, channelCount: 0 };
      existing.profit += evalResult.totalProfit;
      existing.margin += evalResult.avgProfitMargin;
      existing.channelCount++;
      nicheMap.set(niche, existing);
    }

    return Array.from(nicheMap.entries())
      .map(([niche, data]) => ({
        niche,
        totalProfit: Math.round(data.profit * 100) / 100,
        avgMargin: data.channelCount > 0 ? Math.round((data.margin / data.channelCount) * 100) / 100 : 0,
        channels: data.channelCount,
      }))
      .sort((a, b) => b.totalProfit - a.totalProfit)
      .slice(0, limit);
  }

  private async calculateRecentRevenue(projects: any[]): Promise<number> {
    let total = 0;
    for (const p of projects) {
      const views = p.analytics?.views || 0;
      total += (views / 1000) * 5;
      if (p.monetizationConversion) {
        total += p.monetizationConversion.revenue || 0;
      }
    }
    return total;
  }
}
