import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';

export interface MonetizationMetrics {
  projectId: string;
  topic: string;
  videoId: string;
  views: number;
  adRevenue: number;
  affiliateRevenue: number;
  totalRevenue: number;
  aiCost: number;
  profit: number;
  profitMargin: number;
  revenuePerView: number;
  conversionRate: number;
  rpm: number;
}

export interface ChannelMonetizationReport {
  channelId: string;
  channelTitle: string;
  totalVideos: number;
  totalViews: number;
  totalAdRevenue: number;
  totalAffiliateRevenue: number;
  totalRevenue: number;
  totalAiCost: number;
  totalProfit: number;
  avgProfitMargin: number;
  avgRevenuePerView: number;
  bestVideo: MonetizationMetrics | null;
  worstVideo: MonetizationMetrics | null;
  monthlyBreakdown: { month: string; revenue: number; profit: number }[];
}

export class MonetizationAnalytics {
  async computeVideoMonetization(projectId: string): Promise<MonetizationMetrics | null> {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        analytics: true,
        uploadHistory: true,
        monetizationConversion: true,
        monetizationConversionFunnel: true,
      },
    });

    if (!project || !project.uploadHistory) return null;

    const views = project.analytics?.views || 0;
    const rpm = await this.estimateRPM(project.topic);

    const adRevenue = (views / 1000) * rpm;

    const conversions = await prisma.monetizationConversion.findMany({
      where: { projectId },
    });
    const affiliateRevenue = conversions.reduce((s, c) => s + c.revenue, 0);

    const funnel = project.monetizationConversionFunnel;
    const conversionRate = funnel?.overallConversionRate || 0;

    const aiUsage = await prisma.aIUsage.findMany({
      where: {
        userId: project.userId,
        createdAt: { gte: project.createdAt },
      },
    });
    const aiCost = aiUsage.reduce((s, u) => s + (u.estimatedCost || 0), 0);

    const totalRevenue = adRevenue + affiliateRevenue;
    const profit = totalRevenue - aiCost;
    const profitMargin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;
    const revenuePerView = views > 0 ? totalRevenue / views : 0;

    return {
      projectId,
      topic: project.topic,
      videoId: project.uploadHistory.videoId || projectId,
      views,
      adRevenue: Math.round(adRevenue * 100) / 100,
      affiliateRevenue: Math.round(affiliateRevenue * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      aiCost: Math.round(aiCost * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      profitMargin: Math.round(profitMargin * 100) / 100,
      revenuePerView: Math.round(revenuePerView * 10000) / 10000,
      conversionRate: Math.round(conversionRate * 100) / 100,
      rpm: Math.round(rpm * 100) / 100,
    };
  }

  async computeChannelMonetization(channelId: string): Promise<ChannelMonetizationReport | null> {
    const channel = await prisma.youTubeAccount.findFirst({ where: { channelId } });
    if (!channel) return null;

    const projects = await prisma.videoProject.findMany({
      where: { channelId, uploadHistory: { isNot: null } },
      include: { analytics: true, uploadHistory: true },
      orderBy: { createdAt: 'desc' },
    });

    const metricsList: MonetizationMetrics[] = [];
    for (const project of projects) {
      const metrics = await this.computeVideoMonetization(project.id);
      if (metrics) metricsList.push(metrics);
    }

    if (metricsList.length === 0) {
      return {
        channelId,
        channelTitle: channel.channelTitle || '',
        totalVideos: 0,
        totalViews: 0,
        totalAdRevenue: 0,
        totalAffiliateRevenue: 0,
        totalRevenue: 0,
        totalAiCost: 0,
        totalProfit: 0,
        avgProfitMargin: 0,
        avgRevenuePerView: 0,
        bestVideo: null,
        worstVideo: null,
        monthlyBreakdown: [],
      };
    }

    const totals = metricsList.reduce((s, m) => ({
      totalViews: s.totalViews + m.views,
      totalAdRevenue: s.totalAdRevenue + m.adRevenue,
      totalAffiliateRevenue: s.totalAffiliateRevenue + m.affiliateRevenue,
      totalRevenue: s.totalRevenue + m.totalRevenue,
      totalAiCost: s.totalAiCost + m.aiCost,
      totalProfit: s.totalProfit + m.profit,
    }), { totalViews: 0, totalAdRevenue: 0, totalAffiliateRevenue: 0, totalRevenue: 0, totalAiCost: 0, totalProfit: 0 });

    const sortedByProfit = [...metricsList].sort((a, b) => b.profit - a.profit);
    const monthlyMap = new Map<string, { revenue: number; profit: number }>();
    for (const m of metricsList) {
      const month = new Date().toISOString().substring(0, 7);
      const existing = monthlyMap.get(month) || { revenue: 0, profit: 0 };
      existing.revenue += m.totalRevenue;
      existing.profit += m.profit;
      monthlyMap.set(month, existing);
    }

    return {
      channelId,
      channelTitle: channel.channelTitle || '',
      totalVideos: metricsList.length,
      totalViews: totals.totalViews,
      totalAdRevenue: Math.round(totals.totalAdRevenue * 100) / 100,
      totalAffiliateRevenue: Math.round(totals.totalAffiliateRevenue * 100) / 100,
      totalRevenue: Math.round(totals.totalRevenue * 100) / 100,
      totalAiCost: Math.round(totals.totalAiCost * 100) / 100,
      totalProfit: Math.round(totals.totalProfit * 100) / 100,
      avgProfitMargin: totals.totalRevenue > 0 ? Math.round((totals.totalProfit / totals.totalRevenue) * 10000) / 100 : 0,
      avgRevenuePerView: totals.totalViews > 0 ? Math.round((totals.totalRevenue / totals.totalViews) * 10000) / 10000 : 0,
      bestVideo: sortedByProfit[0] || null,
      worstVideo: sortedByProfit[sortedByProfit.length - 1] || null,
      monthlyBreakdown: Array.from(monthlyMap.entries()).map(([month, data]) => ({
        month,
        revenue: Math.round(data.revenue * 100) / 100,
        profit: Math.round(data.profit * 100) / 100,
      })),
    };
  }

  private async estimateRPM(topic: string): Promise<number> {
    const rpmMap: Record<string, number> = {
      'Finance': 15, 'Business': 12, 'True Crime': 10, 'AI': 8,
      'Tech': 6, 'Education': 8, 'Horror': 5, 'Entertainment': 4,
    };
    for (const [key, rpm] of Object.entries(rpmMap)) {
      if (topic.toLowerCase().includes(key.toLowerCase())) return rpm;
    }
    return 5;
  }
}
