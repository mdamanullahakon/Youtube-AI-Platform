import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { PipelineOrchestrator } from '../pipeline/pipeline-orchestrator.service';
import { DailyContentScheduler } from './daily-content-scheduler.service';
import { NotificationService } from './notification.service';
import { RevenueTrackingService, ChannelRevenueReport } from './revenue-tracking.service';
import { generateWithAI } from './ai.service';

export interface CrossChannelReport {
  totalChannels: number;
  totalVideos: number;
  totalViews: number;
  totalRevenue: number;
  totalAiCost: number;
  totalNetProfit: number;
  overallROI: number;
  bestPerformingChannel: string | null;
  worstPerformingChannel: string | null;
  channels: ChannelRevenueReport[];
  recommendations: string[];
  dailyScheduleResults: string[];
}

export class MultiChannelOrchestrator {
  private scheduler: DailyContentScheduler;
  private notifications: NotificationService;
  private revenueTracker: RevenueTrackingService;

  constructor() {
    this.scheduler = new DailyContentScheduler();
    this.notifications = new NotificationService();
    this.revenueTracker = new RevenueTrackingService();
  }

  async runDailyOrchestration(): Promise<CrossChannelReport> {
    logger.info('[MultiChannel] Starting daily orchestration for all channels');

    const scheduleResults = await this.scheduler.runDailyForAllChannels();
    const generated = scheduleResults.filter(r => r.action === 'generated').length;
    const skipped = scheduleResults.filter(r => r.action !== 'generated').length;
    const errors = scheduleResults.filter(r => r.action === 'error').length;

    await this.notifications.sendDailyReport({ generated, skipped, errors });

    const channels = await prisma.youTubeAccount.findMany({
      where: { isConnected: true },
    });

    const channelReports = await Promise.all(
      channels.map(c => this.revenueTracker.getChannelRevenueReport(c.channelId))
    ).then(results => results.filter((r): r is ChannelRevenueReport => r !== null));

    const totalVideos = channelReports.reduce((s, r) => s + r.totalVideos, 0);
    const totalViews = channelReports.reduce((s, r) => s + r.totalViews, 0);
    const totalRevenue = channelReports.reduce((s, r) => s + r.totalRevenue, 0);
    const totalAiCost = channelReports.reduce((s, r) => s + r.totalAiCost, 0);
    const totalNetProfit = totalRevenue - totalAiCost;

    const sortedByRevenue = [...channelReports].sort((a, b) => b.totalRevenue - a.totalRevenue);
    const bestPerformingChannel = sortedByRevenue[0]?.channelTitle || null;
    const worstPerformingChannel = sortedByRevenue[sortedByRevenue.length - 1]?.channelTitle || null;

    const recommendations = await this.generateCrossChannelRecommendations(channelReports);

    return {
      totalChannels: channels.length,
      totalVideos,
      totalViews,
      totalRevenue,
      totalAiCost,
      totalNetProfit,
      overallROI: totalAiCost > 0 ? (totalNetProfit / totalAiCost) * 100 : 0,
      bestPerformingChannel,
      worstPerformingChannel,
      channels: channelReports,
      recommendations,
      dailyScheduleResults: scheduleResults.map(r =>
        `${r.channelTitle}: ${r.action}${r.topic ? ` (${r.topic})` : ''}${r.error ? ` — ${r.error}` : ''}`
      ),
    };
  }

  async getCrossChannelDashboard(userId: string): Promise<CrossChannelReport | null> {
    const channels = await prisma.youTubeAccount.findMany({
      where: { userId, isConnected: true },
    });

    if (channels.length === 0) return null;

    const channelReports = await Promise.all(
      channels.map(c => this.revenueTracker.getChannelRevenueReport(c.channelId))
    ).then(results => results.filter((r): r is ChannelRevenueReport => r !== null));

    const totalVideos = channelReports.reduce((s, r) => s + r.totalVideos, 0);
    const totalViews = channelReports.reduce((s, r) => s + r.totalViews, 0);
    const totalRevenue = channelReports.reduce((s, r) => s + r.totalRevenue, 0);
    const totalAiCost = channelReports.reduce((s, r) => s + r.totalAiCost, 0);
    const totalNetProfit = totalRevenue - totalAiCost;

    const sortedByRevenue = [...channelReports].sort((a, b) => b.totalRevenue - a.totalRevenue);

    return {
      totalChannels: channels.length,
      totalVideos,
      totalViews,
      totalRevenue,
      totalAiCost,
      totalNetProfit,
      overallROI: totalAiCost > 0 ? (totalNetProfit / totalAiCost) * 100 : 0,
      bestPerformingChannel: sortedByRevenue[0]?.channelTitle || null,
      worstPerformingChannel: sortedByRevenue[sortedByRevenue.length - 1]?.channelTitle || null,
      channels: channelReports,
      recommendations: [],
      dailyScheduleResults: [],
    };
  }

  private async generateCrossChannelRecommendations(
    reports: ChannelRevenueReport[]
  ): Promise<string[]> {
    if (reports.length < 2) return [];

    try {
      const reportSummary = reports.map(r => ({
        channel: r.channelTitle,
        videos: r.totalVideos,
        views: r.totalViews,
        revenue: r.totalRevenue,
        roi: r.overallROI,
      }));

      const aiResponse = await generateWithAI(`
        Analyze this multi-channel YouTube performance data and give 3 strategic recommendations:

        ${JSON.stringify(reportSummary, null, 2)}

        Focus on:
        - Which channels to prioritize
        - What content types to double down on
        - Cost optimization suggestions

        Return JSON array of 3 strings.
      `, 'ollama', { temperature: 0.3 });

      try {
        const parsed = JSON.parse(aiResponse);
        if (Array.isArray(parsed)) return parsed.slice(0, 5);
      } catch {}
    } catch {}

    return [
      'Focus on channels with highest ROI per video',
      'Reduce AI costs by batching similar content types',
      'Cross-promote top-performing videos across channels',
    ];
  }
}
