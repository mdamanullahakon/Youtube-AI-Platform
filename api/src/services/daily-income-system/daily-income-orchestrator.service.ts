import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { DailyContentPlanner, DailyTopicReport } from './daily-content-planner.service';
import { TopicSelector, TopicSelectionResult } from './topic-selector.service';
import { VideoCreator, UploadPackage } from './video-creator.service';
import { UploadAutomation, UploadResult } from './upload-automation.service';
import { EarlyGrowthReportService, EarlyGrowthReport } from './early-growth-report.service';
import { FullGrowthReportService, FullGrowthReport } from './full-growth-report.service';
import { BestVideoDetector, DailyWinnerResult } from './best-video-detector.service';
import { NextDayOptimizer, NextDayOptimizationPlan } from './next-day-optimizer.service';

export interface DailyCycleResult {
  date: string;
  channelsProcessed: number;
  totalTopicsGenerated: number;
  totalVideosCreated: number;
  totalUploads: number;
  totalUploadFailures: number;
  earlyReportsGenerated: number;
  fullReportsGenerated: number;
  dailyWinners: DailyWinnerResult[];
  optimizationPlans: NextDayOptimizationPlan[];
  errors: string[];
  duration: number;
  success: boolean;
}

export interface ChannelDailyOutput {
  channelId: string;
  channelTitle: string;
  topicReport: DailyTopicReport;
  selection: TopicSelectionResult;
  packages: UploadPackage[];
  uploadResults: UploadResult[];
  earlyReport: EarlyGrowthReport | null;
  fullReport: FullGrowthReport | null;
  winner: DailyWinnerResult;
  optimizationPlan: NextDayOptimizationPlan;
  errors: string[];
}

const MAX_VIDEOS_PER_DAY = 4;
const MIN_VIDEOS_PER_DAY = 3;

export class DailyIncomeOrchestrator {
  private planner: DailyContentPlanner;
  private selector: TopicSelector;
  private creator: VideoCreator;
  private uploader: UploadAutomation;
  private earlyReport: EarlyGrowthReportService;
  private fullReport: FullGrowthReportService;
  private detector: BestVideoDetector;
  private optimizer: NextDayOptimizer;

  constructor() {
    this.planner = new DailyContentPlanner();
    this.selector = new TopicSelector();
    this.creator = new VideoCreator();
    this.uploader = new UploadAutomation();
    this.earlyReport = new EarlyGrowthReportService();
    this.fullReport = new FullGrowthReportService();
    this.detector = new BestVideoDetector();
    this.optimizer = new NextDayOptimizer();
  }

  async runDailyCycle(dryRun = false): Promise<DailyCycleResult> {
    const startTime = Date.now();
    const date = new Date().toISOString().split('T')[0];
    const errors: string[] = [];
    const winners: DailyWinnerResult[] = [];
    const optimizations: NextDayOptimizationPlan[] = [];
    let totalTopics = 0;
    let totalCreated = 0;
    let totalUploads = 0;
    let totalFailures = 0;
    let earlyCount = 0;
    let fullCount = 0;

    logger.info('╔══════════════════════════════════════════════╗');
    logger.info('║     DAILY INCOME SYSTEM — CYCLE START       ║');
    logger.info(`║     ${date}                                  ║`);
    logger.info('╚══════════════════════════════════════════════╝');

    const channels = await prisma.youTubeAccount.findMany({
      where: { isConnected: true },
    });

    if (channels.length === 0) {
      logger.warn('[DailyIncome] No connected channels found — skipping cycle');
      return {
        date, channelsProcessed: 0, totalTopicsGenerated: 0,
        totalVideosCreated: 0, totalUploads: 0, totalUploadFailures: 0,
        earlyReportsGenerated: 0, fullReportsGenerated: 0,
        dailyWinners: [], optimizationPlans: [], errors: [],
        duration: 0, success: true,
      };
    }

    for (const channel of channels) {
      try {
        const output = await this.processChannel(channel, dryRun);
        totalTopics += output.topicReport.topics.length;
        totalCreated += output.packages.length;
        totalUploads += output.uploadResults.filter(r => r.success).length;
        totalFailures += output.uploadResults.filter(r => !r.success).length;
        if (output.earlyReport) earlyCount++;
        if (output.fullReport) fullCount++;
        winners.push(output.winner);
        optimizations.push(output.optimizationPlan);
        errors.push(...output.errors);
      } catch (err: any) {
        errors.push(`Channel ${channel.channelTitle}: ${err.message}`);
        logger.error(`[DailyIncome] Channel ${channel.channelTitle} failed: ${err.message}`);
      }
    }

    const requeued = await this.uploader.requeueFailedUploads();

    logger.info('╔══════════════════════════════════════════════╗');
    logger.info('║     DAILY INCOME SYSTEM — CYCLE COMPLETE    ║');
    logger.info(`║     Duration: ${Date.now() - startTime}ms                    ║`);
    logger.info(`║     Topics: ${totalTopics} | Created: ${totalCreated}        ║`);
    logger.info(`║     Uploaded: ${totalUploads} | Failed: ${totalFailures}     ║`);
    logger.info(`║     Early Reports: ${earlyCount} | Full: ${fullCount}        ║`);
    logger.info(`║     Requeued: ${requeued}                                    ║`);
    logger.info('╚══════════════════════════════════════════════╝');

    return {
      date,
      channelsProcessed: channels.length,
      totalTopicsGenerated: totalTopics,
      totalVideosCreated: totalCreated,
      totalUploads,
      totalUploadFailures: totalFailures,
      earlyReportsGenerated: earlyCount,
      fullReportsGenerated: fullCount,
      dailyWinners: winners,
      optimizationPlans: optimizations,
      errors,
      duration: Date.now() - startTime,
      success: errors.length === 0,
    };
  }

  private async processChannel(channel: any, dryRun: boolean): Promise<ChannelDailyOutput> {
    const channelId = channel.channelId;
    const channelTitle = channel.channelTitle || 'Unknown';
    const errors: string[] = [];

    logger.info(`[DailyIncome] Processing ${channelTitle}...`);

    const topicReport = await this.planner.planDailyContent(channelId);

    const selection = await this.selector.presentTopicsToUser(topicReport);
    logger.info(`[DailyIncome] ${channelTitle}: Selected "${selection.selectedTopic.title}" (${selection.selectionMethod})`);

    const videoCount = Math.min(MAX_VIDEOS_PER_DAY, Math.max(MIN_VIDEOS_PER_DAY, 3));
    const packages: UploadPackage[] = [];
    const uploadResults: UploadResult[] = [];

    const selectedTopic = selection.selectedTopic;
    const pkg = await this.creator.createUploadPackage(channelId, selectedTopic);
    packages.push(pkg);

    if (!dryRun) {
      const result = await this.uploader.uploadVideo(pkg);
      uploadResults.push(result);

      if (result.success) {
        this.earlyReport.scheduleEarlyCheck(pkg.projectId);
        logger.info(`[DailyIncome] ${channelTitle}: Uploaded "${pkg.title}" — VideoID: ${result.videoId}`);
      } else {
        errors.push(`Upload failed: ${result.error}`);
        const retryResult = await this.uploader.retryFailedUpload(pkg.projectId);
        if (retryResult.success) {
          uploadResults.push(retryResult);
          this.earlyReport.scheduleEarlyCheck(pkg.projectId);
          logger.info(`[DailyIncome] ${channelTitle}: Retry succeeded for "${pkg.title}"`);
        } else {
          errors.push(`Retry also failed: ${retryResult.error}`);
        }
      }
    }

    let earlyReport: EarlyGrowthReport | null = null;
    let fullReport: FullGrowthReport | null = null;

    if (!dryRun && uploadResults.some(r => r.success)) {
      const successResult = uploadResults.find(r => r.success);
      if (successResult) {
        try {
          earlyReport = await this.earlyReport.generateEarlyReport(successResult.projectId);
        } catch (err: any) {
          errors.push(`Early report failed: ${err.message}`);
        }

        setTimeout(async () => {
          try {
            await this.fullReport.generateFullReport(successResult.projectId);
          } catch (err: any) {
            logger.error(`[DailyIncome] Deferred full report failed: ${err.message}`);
          }
        }, 43200000);
      }
    }

    const winner = await this.detector.detectDailyWinner(channelId);

    const optimizationPlan = await this.optimizer.optimizeForTomorrow(channelId, winner);

    if (!dryRun) {
      await this.saveChannelOutput(channelId, {
        topicReport, selection, packages, uploadResults,
        winner, optimizationPlan, errors,
      });
    }

    logger.info(`[DailyIncome] ${channelTitle}: Done — ${packages.length} videos, ${uploadResults.filter(r => r.success).length} uploaded`);

    return {
      channelId, channelTitle,
      topicReport, selection, packages, uploadResults,
      earlyReport, fullReport, winner, optimizationPlan, errors,
    };
  }

  async generateDailyReport(channelId: string): Promise<{
    date: string;
    videosUploaded: number;
    revenue: number;
    bestVideo: string;
    worstVideo: string;
    winnerPattern: string;
    tomorrowStrategy: string[];
  }> {
    const date = new Date().toISOString().split('T')[0];
    const winner = await this.detector.detectDailyWinner(channelId);
    const plan = await this.optimizer.optimizeForTomorrow(channelId, winner);

    const published = await prisma.videoProject.findMany({
      where: { channelId, status: 'published' },
      include: { analytics: true, monetizationConversion: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const totalRevenue = published.reduce((s, p) => {
      const views = p.analytics?.views || 0;
      const convs = p.monetizationConversion || [];
      const convRevenue = Array.isArray(convs) ? convs.reduce((c: number, cv: any) => c + (cv.revenue || 0), 0) : 0;
      return s + (views / 1000) * 4 + convRevenue;
    }, 0);

    const sortedByViews = [...published].sort((a, b) => (b.analytics?.views || 0) - (a.analytics?.views || 0));
    const bestTitle = sortedByViews[0]?.title || 'N/A';
    const worstTitle = sortedByViews[sortedByViews.length - 1]?.title || 'N/A';

    return {
      date,
      videosUploaded: published.length,
      revenue: Math.round(totalRevenue * 100) / 100,
      bestVideo: bestTitle,
      worstVideo: worstTitle,
      winnerPattern: winner.patternSummary,
      tomorrowStrategy: plan.strategyChanges,
    };
  }

  async getSystemStatus(): Promise<{
    status: 'running' | 'idle' | 'error';
    lastCycle: string | null;
    totalChannels: number;
    totalVideosToday: number;
    totalRevenue: number;
    totalUploads: number;
    totalFailures: number;
    recentErrors: string[];
  }> {
    const today = new Date().toISOString().split('T')[0];
    const todayStart = new Date(today);

    const todayVideos = await prisma.videoProject.count({
      where: {
        status: 'published',
        uploadHistory: {
          publishedAt: { gte: todayStart },
        },
      },
    });

    const failedToday = await prisma.videoProject.count({
      where: {
        status: 'failed',
        updatedAt: { gte: todayStart },
      },
    });

    const channels = await prisma.youTubeAccount.count({ where: { isConnected: true } });
    const recentErrors = await prisma.queueJob.findMany({
      where: { status: 'failed', createdAt: { gte: todayStart } },
      select: { error: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    return {
      status: 'idle',
      lastCycle: null,
      totalChannels: channels,
      totalVideosToday: todayVideos,
      totalRevenue: 0,
      totalUploads: todayVideos,
      totalFailures: failedToday,
      recentErrors: recentErrors.map(e => e.error || 'Unknown error').filter(Boolean),
    };
  }

  private async saveChannelOutput(channelId: string, output: any): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    const key = `income:channel_output:${channelId}:${date}`;
    await prisma.appConfig.upsert({
      where: { key },
      update: { value: JSON.stringify({
        topicsGenerated: output.topicReport.topics.length,
        selectionMethod: output.selection.selectionMethod,
        videosCreated: output.packages.length,
        uploadsSucceeded: output.uploadResults.filter((r: any) => r.success).length,
        uploadsFailed: output.uploadResults.filter((r: any) => !r.success).length,
        winnerPattern: output.winner.patternSummary,
        strategyChanges: output.optimizationPlan.strategyChanges,
        errorCount: output.errors.length,
      })},
      create: {
        key,
        value: JSON.stringify({
          topicsGenerated: output.topicReport.topics.length,
          selectionMethod: output.selection.selectionMethod,
          videosCreated: output.packages.length,
          uploadsSucceeded: output.uploadResults.filter((r: any) => r.success).length,
          uploadsFailed: output.uploadResults.filter((r: any) => !r.success).length,
          winnerPattern: output.winner.patternSummary,
          strategyChanges: output.optimizationPlan.strategyChanges,
          errorCount: output.errors.length,
        }),
        description: `Daily income system output for ${channelId} on ${date}`,
      },
    });
  }
}
