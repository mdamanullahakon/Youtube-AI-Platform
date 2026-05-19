import { prisma } from '../config/db';
import { logger } from '../utils/logger';

export interface VideoRevenue {
  projectId: string;
  topic: string;
  views: number;
  estimatedRPM: number;
  estimatedRevenue: number;
  aiCost: number;
  netProfit: number;
  roi: number;
  publishedAt: Date | null;
}

export interface ChannelRevenueReport {
  channelId: string;
  channelTitle: string | null;
  totalVideos: number;
  totalViews: number;
  totalRevenue: number;
  totalAiCost: number;
  totalNetProfit: number;
  overallROI: number;
  avgRPM: number;
  topVideo: VideoRevenue | null;
  videos: VideoRevenue[];
  monthlyTrend: { month: string; revenue: number; views: number }[];
}

export class RevenueTrackingService {
  async getVideoRevenue(projectId: string): Promise<VideoRevenue | null> {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        analytics: true,
        uploadHistory: true,
      },
    });

    if (!project || !project.uploadHistory?.publishedAt) return null;

    const views = project.analytics?.views || 0;
    const rpm = await this.estimateChannelRPM(project.userId);
    const estimatedRevenue = (views / 1000) * rpm;
    const aiCost = await this.getProjectAICost(projectId);

    return {
      projectId,
      topic: project.topic,
      views,
      estimatedRPM: rpm,
      estimatedRevenue,
      aiCost,
      netProfit: estimatedRevenue - aiCost,
      roi: aiCost > 0 ? ((estimatedRevenue - aiCost) / aiCost) * 100 : 0,
      publishedAt: project.uploadHistory.publishedAt,
    };
  }

  async getChannelRevenueReport(channelId: string): Promise<ChannelRevenueReport | null> {
    const channel = await prisma.youTubeAccount.findFirst({
      where: { channelId },
      include: {
        user: { select: { id: true } },
      },
    });

    if (!channel) return null;

    const projects = await prisma.videoProject.findMany({
      where: { channelId, uploadHistory: { isNot: null } },
      include: {
        analytics: true,
        uploadHistory: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const rpm = await this.estimateChannelRPM(channel.userId);
    const videoRevenues: VideoRevenue[] = [];

    for (const project of projects) {
      if (!project.uploadHistory?.publishedAt) continue;
      const views = project.analytics?.views || 0;
      const estimatedRevenue = (views / 1000) * rpm;
      const aiCost = await this.getProjectAICost(project.id);

      videoRevenues.push({
        projectId: project.id,
        topic: project.topic,
        views,
        estimatedRPM: rpm,
        estimatedRevenue,
        aiCost,
        netProfit: estimatedRevenue - aiCost,
        roi: aiCost > 0 ? ((estimatedRevenue - aiCost) / aiCost) * 100 : 0,
        publishedAt: project.uploadHistory.publishedAt,
      });
    }

    const totalViews = videoRevenues.reduce((s, v) => s + v.views, 0);
    const totalRevenue = videoRevenues.reduce((s, v) => s + v.estimatedRevenue, 0);
    const totalAiCost = videoRevenues.reduce((s, v) => s + v.aiCost, 0);
    const totalNetProfit = totalRevenue - totalAiCost;

    const monthlyMap = new Map<string, { revenue: number; views: number }>();
    for (const v of videoRevenues) {
      if (!v.publishedAt) continue;
      const key = `${v.publishedAt.getFullYear()}-${String(v.publishedAt.getMonth() + 1).padStart(2, '0')}`;
      const existing = monthlyMap.get(key) || { revenue: 0, views: 0 };
      existing.revenue += v.estimatedRevenue;
      existing.views += v.views;
      monthlyMap.set(key, existing);
    }

    const monthlyTrend = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data }));

    const topVideo = videoRevenues.length > 0
      ? videoRevenues.reduce((best, v) => v.views > best.views ? v : best)
      : null;

    return {
      channelId,
      channelTitle: channel.channelTitle,
      totalVideos: videoRevenues.length,
      totalViews,
      totalRevenue,
      totalAiCost,
      totalNetProfit,
      overallROI: totalAiCost > 0 ? (totalNetProfit / totalAiCost) * 100 : 0,
      avgRPM: totalViews > 0 ? (totalRevenue / totalViews) * 1000 : 0,
      topVideo,
      videos: videoRevenues,
      monthlyTrend,
    };
  }

  async getBusinessDashboard(userId: string) {
    const channels = await prisma.youTubeAccount.findMany({
      where: { userId, isConnected: true },
    });

    const channelReports = await Promise.all(
      channels.map(c => this.getChannelRevenueReport(c.channelId))
    );

    const totalRevenue = channelReports.reduce((s, r) => s + (r?.totalRevenue || 0), 0);
    const totalCost = channelReports.reduce((s, r) => s + (r?.totalAiCost || 0), 0);
    const totalViews = channelReports.reduce((s, r) => s + (r?.totalViews || 0), 0);
    const totalVideos = channelReports.reduce((s, r) => s + (r?.totalVideos || 0), 0);

    const dailyAiCost = await this.getDailyAICost();
    const monthlyAiCost = await this.getMonthlyAICost(userId);

    return {
      totalRevenue,
      totalCost,
      totalNetProfit: totalRevenue - totalCost,
      overallROI: totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : 0,
      totalViews,
      totalVideos,
      activeChannels: channels.length,
      dailyAiCost,
      monthlyAiCost,
      channels: channelReports.filter(Boolean),
    };
  }

  private async estimateChannelRPM(userId: string): Promise<number> {
    const metrics = await prisma.channelMetrics.findFirst({
      where: { userId },
      orderBy: { collectedAt: 'desc' },
      select: { estimatedRPM: true },
    });
    return metrics?.estimatedRPM || 2.50;
  }

  private async getProjectAICost(projectId: string): Promise<number> {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });
    if (!project) return 0;

    const projectStart = await prisma.videoProject.findUnique({
      where: { id: projectId },
      select: { createdAt: true },
    });
    if (!projectStart) return 0;

    const usages = await prisma.aIUsage.findMany({
      where: {
        userId: project.userId,
        createdAt: { gte: projectStart.createdAt },
      },
    });

    return usages.reduce((sum, u) => sum + (u.estimatedCost || 0), 0);
  }

  private async getDailyAICost(): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const usages = await prisma.aIUsage.findMany({
      where: { createdAt: { gte: today } },
    });
    return usages.reduce((sum, u) => sum + (u.estimatedCost || 0), 0);
  }

  private async getMonthlyAICost(userId: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const usages = await prisma.aIUsage.findMany({
      where: {
        userId,
        createdAt: { gte: startOfMonth },
      },
    });
    return usages.reduce((sum, u) => sum + (u.estimatedCost || 0), 0);
  }
}
