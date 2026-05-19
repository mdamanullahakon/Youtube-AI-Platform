import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { CompetitorIntelligenceEngine, type CompetitiveAnalysis } from './competitor-intelligence.service';
import { ViralTopicFinder, type ViralTopicIdea } from './viral-topic-finder.service';
import { CrossChannelIntelligence } from './cross-channel-intelligence.service';
import { ContentStrategyEngine } from './content-strategy.service';
import { HorrorPipelineService } from '../pipeline/horror-pipeline.service';
import { AnalyticsSelfImproveEngine } from './horror/analytics-self-improve.service';
import { MultiChannelEngine } from './horror/multi-channel.service';
import { MonetizationIntelligence, type MonetizationStrategy } from './horror/monetization-intelligence.service';
import type { ChannelStrategy } from './content-strategy.service';
import type { CrossChannelStrategy } from './cross-channel-intelligence.service';

export interface DailyIntelligenceReport {
  date: string;
  topics: ViralTopicIdea[];
  competitorAnalyses: CompetitiveAnalysis[];
  crossChannelStrategy: any;
  channelStrategies: any[];
  monetizationStrategies: MonetizationStrategy[];
  recommendations: string[];
  videosScheduled: number;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'error';
  channelsConnected: number;
  totalVideos: number;
  avgCTR: number;
  avgRetention: number;
  lastAnalysisDate: string;
  pipelineStatus: string;
  errors: string[];
}

export class GlobalIntelligenceEngine {
  private competitorIntel: CompetitorIntelligenceEngine;
  private topicFinder: ViralTopicFinder;
  private crossChannelIntel: CrossChannelIntelligence;
  private contentStrategy: ContentStrategyEngine;
  private horrorPipeline: HorrorPipelineService;
  private analyticsSelfImprove: AnalyticsSelfImproveEngine;
  private multiChannel: MultiChannelEngine;
  private monetization: MonetizationIntelligence;

  constructor() {
    this.competitorIntel = new CompetitorIntelligenceEngine();
    this.topicFinder = new ViralTopicFinder();
    this.crossChannelIntel = new CrossChannelIntelligence();
    this.contentStrategy = new ContentStrategyEngine();
    this.horrorPipeline = new HorrorPipelineService();
    this.analyticsSelfImprove = new AnalyticsSelfImproveEngine();
    this.multiChannel = new MultiChannelEngine();
    this.monetization = new MonetizationIntelligence();
  }

  async runDailyCycle(userId: string, niches: string[] = ['horror', 'paranormal', 'true crime', 'unsolved mysteries']): Promise<DailyIntelligenceReport> {
    logger.info(`[GlobalIntel] Starting daily cycle for ${niches.length} niches`);

    const topics = await this.topicFinder.findDailyTopics(niches);
    logger.info(`[GlobalIntel] Found ${topics.length} viral topic ideas`);

    const competitorAnalyses: CompetitiveAnalysis[] = [];
    for (const niche of niches.slice(0, 2)) {
      const analysis = await this.competitorIntel.analyzeNiche(niche, 3);
      competitorAnalyses.push(analysis);
    }

    const crossChannelStrategy = await this.crossChannelIntel.analyzeAllChannels(userId);
    logger.info(`[GlobalIntel] Cross-channel analysis complete: ${crossChannelStrategy.topStrategies.length} strategy transfers`);

    const accounts = await prisma.youTubeAccount.findMany({
      where: { userId, isConnected: true },
      take: 5,
    });

    const channelStrategies: ChannelStrategy[] = [];
    for (const acc of accounts) {
      try {
        const strategy = await this.contentStrategy.generateStrategy(acc.channelId, userId);
        channelStrategies.push(strategy);
      } catch (err: any) {
        logger.warn(`[GlobalIntel] Strategy failed for ${acc.channelId}: ${err.message}`);
      }
    }
    logger.info(`[GlobalIntel] Generated ${channelStrategies.length} channel strategies`);

    const monetizationStrategies: MonetizationStrategy[] = [];
    for (const niche of niches) {
      try {
        const strategy = await this.monetization.getStrategyForNiche(niche);
        monetizationStrategies.push(strategy);
      } catch {}
    }

    let videosScheduled = 0;
    const topTopic = topics[0];
    if (topTopic && accounts.length > 0) {
      try {
        const projectId = `daily_${Date.now()}`;
        await this.prismaCreateProject(projectId, userId, accounts[0].channelId, topTopic.title);
        videosScheduled++;
        logger.info(`[GlobalIntel] Scheduled video: "${topTopic.title}"`);
      } catch {}
    }

    const recommendations = this.generateGlobalRecommendations(topics, competitorAnalyses, crossChannelStrategy, channelStrategies);

    logger.info(`[GlobalIntel] Daily cycle complete: ${topics.length} topics, ${competitorAnalyses.length} analyses, ${videosScheduled} videos`);

    return {
      date: new Date().toISOString(),
      topics,
      competitorAnalyses,
      crossChannelStrategy,
      channelStrategies,
      monetizationStrategies,
      recommendations,
      videosScheduled,
    };
  }

  async getSystemHealth(userId: string): Promise<SystemHealth> {
    const errors: string[] = [];
    try {
      const accounts = await prisma.youTubeAccount.findMany({ where: { userId, isConnected: true } });
      const uploads = await prisma.uploadHistory.findMany({ where: { userId } });
      const analytics = await prisma.analytics.findMany({
        where: { project: { userId } },
        orderBy: { collectedAt: 'desc' },
        take: 50,
      });

      const avgCTR = analytics.length > 0
        ? analytics.reduce((s, a) => s + a.ctr, 0) / analytics.length
        : 0;
      const avgRetention = analytics.length > 0
        ? analytics.reduce((s, a) => s + a.retention, 0) / analytics.length
        : 0;

      const lastAnalysis = await prisma.trendResearch.findFirst({ orderBy: { analyzedAt: 'desc' } });

      return {
        status: errors.length > 3 ? 'error' : errors.length > 0 ? 'degraded' : 'healthy',
        channelsConnected: accounts.length,
        totalVideos: uploads.length,
        avgCTR: Math.round(avgCTR * 100) / 100,
        avgRetention: Math.round(avgRetention),
        lastAnalysisDate: lastAnalysis?.analyzedAt?.toISOString() || 'never',
        pipelineStatus: accounts.length > 0 ? 'ready' : 'no_channels',
        errors,
      };
    } catch (err: any) {
      errors.push(err.message);
      return {
        status: 'error', channelsConnected: 0, totalVideos: 0,
        avgCTR: 0, avgRetention: 0, lastAnalysisDate: 'never',
        pipelineStatus: 'error', errors,
      };
    }
  }

  private generateGlobalRecommendations(
    topics: ViralTopicIdea[],
    competitorAnalyses: CompetitiveAnalysis[],
    crossChannelStrategy: CrossChannelStrategy,
    channelStrategies: ChannelStrategy[]
  ): string[] {
    const recs: string[] = [];

    if (topics.length > 0) {
      recs.push(`Top viral opportunity: "${topics[0].title}" (score: ${topics[0].overallScore})`);
    }
    if (competitorAnalyses.length > 0) {
      const gaps = competitorAnalyses.flatMap(a => a.contentOpportunities);
      if (gaps.length > 0) recs.push(`Content gap: ${gaps[0]}`);
    }
    if (crossChannelStrategy.recommendations.length > 0) {
      recs.push(crossChannelStrategy.recommendations[0]);
    }
    if (crossChannelStrategy.topStrategies.length > 0) {
      const t = crossChannelStrategy.topStrategies[0];
      recs.push(`Strategy transfer: ${t.strategy} (expected: ${t.expectedImprovement})`);
    }
    if (channelStrategies.length === 0) {
      recs.push('Connect YouTube channels to enable full pipeline');
    }

    return recs;
  }

  private async prismaCreateProject(projectId: string, userId: string, channelId: string, title: string): Promise<void> {
    await prisma.videoProject.create({
      data: { id: projectId, userId, channelId, topic: title, status: 'draft' },
    }).catch(() => {});
  }
}
