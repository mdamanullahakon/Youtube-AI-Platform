import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { UploadTimeOptimizer } from './upload-time-optimizer.service';
import { FeedbackLoopService } from './feedback-loop.service';
import { ViralIntelligenceService } from './viral-intelligence.service';
import type {
  ChannelHealthReport,
  VideoPerformanceSummary,
  ContentStrategyPlan,
  WeeklyContentItem,
  UploadSchedulePlan,
  TimeSlot,
  GrowthScoreResult,
  StrategyDecision,
  ContentMixPlan,
  CorrectionAction,
  GrowthCycleReport,
  ContentMixRecommendation,
} from './channel-growth.types';

const VIRAL_WEIGHT = 0.25;
const EVERGREEN_WEIGHT = 0.25;
const SUB_GROWTH_WEIGHT = 0.20;
const WATCH_TIME_WEIGHT = 0.20;
const CONSISTENCY_WEIGHT = 0.10;

export class ChannelGrowthService {
  private uploadTimeOptimizer: UploadTimeOptimizer;
  private feedbackLoop: FeedbackLoopService;
  private viralIntelligence: ViralIntelligenceService;

  constructor() {
    this.uploadTimeOptimizer = new UploadTimeOptimizer();
    this.feedbackLoop = new FeedbackLoopService();
    this.viralIntelligence = new ViralIntelligenceService();
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 1: CHANNEL STATE ANALYZER
  // ────────────────────────────────────────────────────────────

  async analyzeChannelMetrics(channelId: string): Promise<ChannelHealthReport> {
    logger.info(`[ChannelGrowth] Analyzing channel ${channelId}`);

    // Get recent videos with analytics
    const recentVideos = await prisma.videoProject.findMany({
      where: { channelId, status: 'published' },
      include: { analytics: true, uploadHistory: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const videoSummaries: VideoPerformanceSummary[] = recentVideos.map(v => ({
      videoId: v.uploadHistory?.videoId || v.id,
      title: v.title || v.topic,
      views: v.analytics?.views || 0,
      ctr: v.analytics?.ctr || 0,
      retention: v.analytics?.retention || 0,
      likes: v.analytics?.likes || 0,
      comments: v.analytics?.comments || 0,
      publishedAt: v.uploadHistory?.publishedAt || v.createdAt,
    }));

    const ctrTrend = videoSummaries.map(v => v.ctr).filter(c => c > 0);
    const retentionTrend = videoSummaries.map(v => v.retention).filter(r => r > 0);

    const avgCtr = ctrTrend.length > 0 ? ctrTrend.reduce((a, b) => a + b, 0) / ctrTrend.length : 0;
    const avgRetention = retentionTrend.length > 0 ? retentionTrend.reduce((a, b) => a + b, 0) / retentionTrend.length : 0;

    // Subscriber growth rate
    const channelMetrics = await prisma.channelMetrics.findFirst({ where: { channelId } });
    const subscriberGrowthRate = channelMetrics?.subscriberGrowth || 0;

    // Impressions vs clicks
    const totalImpressions = videoSummaries.reduce((s, v) => s + (v.ctr > 0 ? v.views / (v.ctr / 100) : 0), 0);
    const totalClicks = videoSummaries.reduce((s, v) => s + v.views, 0);
    const overallCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;

    // Upload frequency
    const videoCount = recentVideos.length;
    const oldestDate = videoCount >= 2 ? recentVideos[videoCount - 1].createdAt : new Date();
    const daysSpan = Math.max(1, (Date.now() - oldestDate.getTime()) / 86400000);
    const videosPerWeek = (videoCount / daysSpan) * 7;

    // Growth trend detection
    const growthTrend = this.detectGrowthTrend(ctrTrend, retentionTrend, subscriberGrowthRate);

    // Channel health score
    const channelHealthScore = this.computeChannelHealth(avgCtr, avgRetention, subscriberGrowthRate, videosPerWeek);

    // Weak points
    const weakPoints: string[] = [];
    if (avgCtr < 3) weakPoints.push('CTR below 3% — titles/thumbnails need improvement');
    if (avgRetention < 30) weakPoints.push('Retention below 30% — hook and pacing need work');
    if (subscriberGrowthRate < 5) weakPoints.push('Subscriber growth rate low — consider subscriber-focused content');
    if (videosPerWeek < 2) weakPoints.push('Low upload frequency — consistency is key for algorithm');
    if (ctrTrend.length >= 3 && this.isDeclining(ctrTrend)) weakPoints.push('CTR declining trend — audience fatigue detected');
    if (retentionTrend.length >= 3 && this.isDeclining(retentionTrend)) weakPoints.push('Retention declining trend — content structure may need change');

    return {
      channelId,
      channelHealthScore,
      growthTrend,
      weakPoints,
      last10Videos: videoSummaries,
      ctrTrend,
      retentionTrend,
      subscriberGrowthRate,
      impressionsVsClicks: { impressions: Math.round(totalImpressions), clicks: totalClicks, ctr: Math.round(overallCtr * 100) / 100 },
      uploadFrequency: { videosPerWeek: Math.round(videosPerWeek * 10) / 10, consistency: videoCount > 0 ? Math.min(100, (videoCount / Math.max(1, daysSpan)) * 100) : 0 },
    };
  }

  private detectGrowthTrend(ctrTrend: number[], retentionTrend: number[], subGrowth: number): 'up' | 'down' | 'stable' {
    const recentCtr = ctrTrend.slice(0, 3);
    const recentRet = retentionTrend.slice(0, 3);
    if (recentCtr.length < 2 && recentRet.length < 2) return 'stable';

    const ctrDir = this.trendDirection(recentCtr);
    const retDir = this.trendDirection(recentRet);

    if (ctrDir === 'up' && retDir === 'up' && subGrowth > 0) return 'up';
    if (ctrDir === 'down' || retDir === 'down') return 'down';
    return 'stable';
  }

  private trendDirection(values: number[]): 'up' | 'down' | 'flat' {
    if (values.length < 2) return 'flat';
    const first = values[values.length - 1];
    const last = values[0];
    const diff = last - first;
    if (diff > 1) return 'up';
    if (diff < -1) return 'down';
    return 'flat';
  }

  private isDeclining(values: number[]): boolean {
    if (values.length < 3) return false;
    const half = Math.floor(values.length / 2);
    const firstHalf = values.slice(half).reduce((a, b) => a + b, 0) / half;
    const secondHalf = values.slice(0, half).reduce((a, b) => a + b, 0) / half;
    return secondHalf < firstHalf * 0.8;
  }

  private computeChannelHealth(avgCtr: number, avgRetention: number, subGrowth: number, freq: number): number {
    const ctrScore = Math.min(100, (avgCtr / 10) * 100);
    const retentionScore = Math.min(100, avgRetention);
    const subScore = Math.min(100, subGrowth * 2);
    const freqScore = Math.min(100, (freq / 7) * 100);

    return Math.round(ctrScore * 0.30 + retentionScore * 0.30 + subScore * 0.20 + freqScore * 0.20);
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 2: TOPIC STRATEGY ENGINE
  // ────────────────────────────────────────────────────────────

  async generateContentStrategy(channelId: string): Promise<ContentStrategyPlan> {
    logger.info(`[ChannelGrowth] Generating content strategy for ${channelId}`);

    // Get winning patterns and viral opportunities
    const [winningPatterns, viralOpps, recentProjects] = await Promise.all([
      prisma.winningPattern.findMany({ where: { score: { gte: 50 } }, orderBy: { score: 'desc' }, take: 20 }),
      prisma.viralOpportunity.findMany({ where: { viralScore: { gte: 60 }, saturationScore: { lt: 80 } }, orderBy: { viralScore: 'desc' }, take: 30 }),
      prisma.videoProject.findMany({ where: { channelId }, include: { analytics: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);

    // Identify forbidden topics (low ROI)
    const forbiddenTopics = this.identifyForbiddenTopics(recentProjects);

    // Identify winning niches
    const winningNiches = this.identifyWinningNiches(winningPatterns, recentProjects);

    // Build topic priority list
    const topicPriorityList = viralOpps
      .filter(o => !forbiddenTopics.some(f => o.topic.toLowerCase().includes(f.toLowerCase())))
      .slice(0, 15)
      .map(o => o.topic);

    // Get content mix recommendation
    const mixRecommendation = await this.getContentMixRecommendation(channelId);

    // Build weekly plan
    const weeklyPlan = await this.buildWeeklyPlan(channelId, topicPriorityList, winningNiches, mixRecommendation);

    // Persist content mix plan
    await this.persistContentMixPlan(channelId, mixRecommendation, topicPriorityList, winningNiches, forbiddenTopics);

    return {
      channelId,
      weeklyPlan,
      topicPriorityList,
      forbiddenTopics,
      winningNiches,
      mixRecommendation,
    };
  }

  private identifyForbiddenTopics(projects: any[]): string[] {
    const forbidden: string[] = [];
    const topicPerformance = new Map<string, number[]>();

    for (const p of projects) {
      if (!p.analytics) continue;
      const existing = topicPerformance.get(p.topic.toLowerCase()) || [];
      existing.push(p.analytics.ctr || 0);
      topicPerformance.set(p.topic.toLowerCase(), existing);
    }

    for (const [topic, ctrs] of topicPerformance) {
      const avgCtr = ctrs.reduce((a, b) => a + b, 0) / ctrs.length;
      if (avgCtr < 1.5 && ctrs.length >= 2) {
        forbidden.push(topic);
      }
    }

    // Also mark high-saturation topics from DB
    try {
      prisma.viralOpportunity.findMany({
        where: { saturationScore: { gte: 85 } },
        select: { topic: true },
        take: 10,
      }).then(opps => {
        for (const o of opps) {
          if (!forbidden.includes(o.topic)) forbidden.push(o.topic);
        }
      }).catch(() => {});
    } catch { /* non-critical */ }

    return forbidden.slice(0, 10);
  }

  private identifyWinningNiches(patterns: any[], projects: any[]): string[] {
    const niches = new Set<string>();

    for (const p of patterns) {
      if (p.niche && p.score >= 60) niches.add(p.niche);
    }

    // From projects with good analytics
    for (const p of projects) {
      if (p.analytics && (p.analytics.ctr >= 4 || p.analytics.retention >= 50)) {
        const niche = p.topic.split(/\s+/).slice(0, 2).join(' ');
        if (niche.length > 3) niches.add(niche.toLowerCase());
      }
    }

    return Array.from(niches).slice(0, 10);
  }

  private async buildWeeklyPlan(
    channelId: string,
    topics: string[],
    niches: string[],
    mix: ContentMixRecommendation,
  ): Promise<WeeklyContentItem[]> {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const plan: WeeklyContentItem[] = [];

    // Determine content type distribution based on mix
    const totalSlots = Math.min(7, Math.max(3, topics.length));
    const viralCount = Math.round(totalSlots * (mix.viralPct / 100));
    const evergreenCount = Math.round(totalSlots * (mix.evergreenPct / 100));
    const authorityCount = totalSlots - viralCount - evergreenCount;

    const contentTypeOrder: ('viral' | 'evergreen' | 'authority')[] = [];
    for (let i = 0; i < viralCount; i++) contentTypeOrder.push('viral');
    for (let i = 0; i < evergreenCount; i++) contentTypeOrder.push('evergreen');
    for (let i = 0; i < authorityCount; i++) contentTypeOrder.push('authority');

    // Shuffle for variety
    contentTypeOrder.sort(() => Math.random() - 0.5);

    for (let i = 0; i < Math.min(totalSlots, days.length); i++) {
      const contentType = contentTypeOrder[i] || 'viral';
      const topic = topics[i % topics.length] || (niches[i % niches.length] || 'trending topic');

      plan.push({
        day: days[i],
        topic,
        contentType,
        expectedCtr: contentType === 'viral' ? 6 : contentType === 'evergreen' ? 3 : 4,
        expectedRetention: contentType === 'evergreen' ? 50 : contentType === 'authority' ? 45 : 35,
        hookSuggestion: this.getHookSuggestion(contentType),
      });
    }

    return plan;
  }

  private getHookSuggestion(type: 'viral' | 'evergreen' | 'authority'): string {
    switch (type) {
      case 'viral': return 'Curiosity gap or shocking statistic in first 3 seconds';
      case 'evergreen': return 'Problem-solution framing, "How to" or "Complete guide"';
      case 'authority': return 'Data-driven insight, research-backed, expert perspective';
    }
  }

  private async getContentMixRecommendation(channelId: string): Promise<ContentMixRecommendation> {
    // Check for existing active plan
    const existingPlan = await prisma.contentMixPlan.findFirst({
      where: { channelId, active: true },
    });

    if (existingPlan) {
      return {
        viralPct: existingPlan.viralPct,
        evergreenPct: existingPlan.evergreenPct,
        authorityPct: existingPlan.authorityPct,
        reasoning: 'Using existing active content mix plan',
      };
    }

    // Check channel performance to adjust mix
    const channelMetrics = await prisma.channelMetrics.findFirst({ where: { channelId } });

    let viralPct = 40;
    let evergreenPct = 40;
    let authorityPct = 20;

    if (channelMetrics) {
      const avgCtr = channelMetrics.avgCTR || 0;

      // Channels with high CTR can push more viral
      if (avgCtr >= 5) {
        viralPct = 50;
        evergreenPct = 30;
        authorityPct = 20;
      }
      // Channels with low CTR need more evergreen (stable growth)
      if (avgCtr < 2) {
        viralPct = 20;
        evergreenPct = 60;
        authorityPct = 20;
      }
    }

    return {
      viralPct, evergreenPct, authorityPct,
      reasoning: `Mix optimized for channel performance: ${viralPct}% viral / ${evergreenPct}% evergreen / ${authorityPct}% authority`,
    };
  }

  private async persistContentMixPlan(
    channelId: string, mix: ContentMixRecommendation,
    topics: string[], niches: string[], forbidden: string[],
  ): Promise<void> {
    try {
      // Deactivate old plans
      await prisma.contentMixPlan.updateMany({
        where: { channelId, active: true },
        data: { active: false },
      });

      await prisma.contentMixPlan.create({
        data: {
          channelId,
          viralPct: mix.viralPct,
          evergreenPct: mix.evergreenPct,
          authorityPct: mix.authorityPct,
          viralTopics: topics.slice(0, 5),
          evergreenTopics: topics.slice(5, 10),
          authorityTopics: niches.slice(0, 3),
          forbiddenTopics: forbidden,
          winningNiches: niches,
          active: true,
        },
      });
    } catch (err: any) {
      logger.warn(`[ChannelGrowth] Failed to persist content mix plan: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 3: UPLOAD TIMING OPTIMIZER
  // ────────────────────────────────────────────────────────────

  async optimizeUploadSchedule(channelId: string): Promise<UploadSchedulePlan> {
    logger.info(`[ChannelGrowth] Optimizing upload schedule for ${channelId}`);

    const channelMetrics = await prisma.channelMetrics.findFirst({ where: { channelId } });
    const timezone = channelMetrics?.metadata as { timezone?: string } | null;

    // Get recommendation from existing UploadTimeOptimizer
    const recommendation = await this.uploadTimeOptimizer.getBestTime(channelId, timezone?.timezone || 'UTC');

    const bestTimeSlots: TimeSlot[] = [{
      hour: recommendation.hour,
      day: recommendation.day,
      score: recommendation.score,
      predictedViews: recommendation.predictedViews,
      confidence: recommendation.confidence,
    }];

    // Add alternative slots from DB
    try {
      const allSlots = await prisma.uploadTimeMetric.findMany({
        where: { channelId },
        orderBy: { score: 'desc' },
        take: 3,
      });
      for (const slot of allSlots) {
        if (!bestTimeSlots.some(s => s.hour === slot.uploadHour && s.day === slot.uploadDay)) {
          bestTimeSlots.push({
            hour: slot.uploadHour,
            day: slot.uploadDay,
            score: slot.score,
            predictedViews: slot.avgViews,
            confidence: slot.sampleSize > 5 ? 0.8 : 0.3,
          });
        }
      }
    } catch { /* use AI recommendation only */ }

    // Calculate optimal frequency
    const recentProjects = await prisma.videoProject.count({
      where: { channelId, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } },
    });
    const optimalFrequencyPerWeek = Math.min(7, Math.max(1, Math.round(recentProjects / 4) + 1));

    // Cooldown: avoid uploading more than once every X days
    const cooldownDays = optimalFrequencyPerWeek >= 5 ? 1 : optimalFrequencyPerWeek >= 3 ? 2 : 3;

    return {
      channelId,
      bestTimeSlots: bestTimeSlots.sort((a, b) => b.score - a.score).slice(0, 3),
      optimalFrequencyPerWeek,
      cooldownDays,
      timezone: timezone?.timezone || 'UTC',
    };
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 4: GROWTH LOOP LEARNING ENGINE
  // ────────────────────────────────────────────────────────────

  async learnFromPerformance(projectId: string): Promise<void> {
    logger.info(`[ChannelGrowth] Learning from performance for ${projectId}`);

    try {
      const project = await prisma.videoProject.findUnique({
        where: { id: projectId },
        include: {
          analytics: true,
          contentPerformance: true,
          uploadHistory: true,
          script: true,
        },
      });

      if (!project || !project.analytics) {
        logger.warn(`[ChannelGrowth] No analytics data for ${projectId}`);
        return;
      }

      const actualCTR = project.analytics.ctr || 0;
      const actualRetention = project.analytics.retention || 0;
      const predictedCTR = project.contentPerformance?.predictedThumbnailCTR || 0;
      const predictedRetention = project.contentPerformance?.predictedRetention || 0;

      const ctrDeviation = predictedCTR > 0 ? ((actualCTR - predictedCTR) / predictedCTR) * 100 : 0;
      const retentionDeviation = predictedRetention > 0 ? ((actualRetention - predictedRetention) / predictedRetention) * 100 : 0;

      // Store winning patterns if performance is good
      if (actualCTR >= 4 || actualRetention >= 50) {
        const score = (actualCTR * 10 + actualRetention) / 2;
        await prisma.winningPattern.create({
          data: {
            category: 'viral-topic',
            content: `Topic: ${project.topic}`,
            patternType: 'high-performance',
            source: 'growth-loop-learning',
            score: Math.max(0, score),
            sampleSize: 1,
            avgRetention: actualRetention,
            avgCTR: actualCTR,
            confidence: Math.min(1, score / 100),
            metadata: { projectId, ctrDeviation, retentionDeviation },
          },
        }).catch(() => {});

        // Try IncomeWinnerPattern
        if (project.channelId) {
          await prisma.incomeWinnerPattern.create({
            data: {
              patternType: 'viral-topic',
              patternValue: project.topic,
              niche: project.topic.substring(0, 30),
              channelId: project.channelId,
              score: Math.max(0, score),
              sampleSize: 1,
              avgCtr: actualCTR,
              avgRetention: actualRetention,
              confidence: Math.min(1, score / 100),
            },
          }).catch(() => {});
        }
      }

      // Store failed patterns if performance is poor
      if (actualCTR < 1.5 || actualRetention < 20) {
        await prisma.failedPattern.create({
          data: {
            channelId: project.channelId,
            patternType: 'topic',
            patternValue: project.topic,
            failureReason: actualCTR < 1.5 ? 'low-ctr' : 'low-retention',
            avgScore: Math.min(actualCTR * 10, actualRetention),
            sampleSize: 1,
          },
        }).catch(() => {});
      }

      // Run the existing feedback loop analysis
      await this.feedbackLoop.analyzeAfterUpload(projectId).catch(() => {});

      // Update the content performance record
      if (project.contentPerformance) {
        await prisma.contentPerformance.update({
          where: { projectId },
          data: {
            actualViews: project.analytics.views || 0,
            actualCTR,
            actualRetention,
            actualWatchTime: project.analytics.watchTime || 0,
            hookGap: predictedCTR > 0 ? actualCTR - predictedCTR : null,
            retentionGap: predictedRetention > 0 ? actualRetention - predictedRetention : null,
          },
        }).catch(() => {});
      }

      // Run ViralIntelligence self-learning
      await this.viralIntelligence.runSelfLearning(projectId).catch(() => {});

      // Track upload time performance
      if (project.uploadHistory?.publishedAt) {
        const pubDate = project.uploadHistory.publishedAt;
        await this.uploadTimeOptimizer.trackPerformance(
          project.channelId || '',
          project.userId,
          pubDate.getUTCHours(),
          ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][pubDate.getUTCDay()],
          project.analytics.views || 0,
          actualCTR,
          actualRetention,
        ).catch(() => {});
      }

      logger.info(`[ChannelGrowth] Learning complete for ${projectId}: CTR(actual=${actualCTR.toFixed(1)}%, pred=${predictedCTR.toFixed(1)}%) Retention(actual=${actualRetention.toFixed(1)}%, pred=${predictedRetention.toFixed(1)}%)`);
    } catch (err: any) {
      logger.error(`[ChannelGrowth] Learning failed for ${projectId}: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 5: CHANNEL GROWTH SCORE ENGINE
  // ────────────────────────────────────────────────────────────

  async calculateChannelGrowthScore(channelId: string): Promise<GrowthScoreResult> {
    logger.info(`[ChannelGrowth] Calculating growth score for ${channelId}`);

    const channelMetrics = await prisma.channelMetrics.findFirst({ where: { channelId } });

    const avgCtr = channelMetrics?.avgCTR || 0;
    const avgRetention = channelMetrics?.avgRetention || 0;
    const subscriberGrowth = channelMetrics?.subscriberGrowth || 0;
    const watchTimeHours = (channelMetrics?.monthlyWatchHours || 0);

    // Normalize scores to 0-100
    const ctrScore = Math.min(100, (avgCtr / 10) * 100);
    const retentionScore = Math.min(100, avgRetention);

    // Convert absolute subscriber growth to a score
    const subScore = Math.min(100, Math.max(0, subscriberGrowth * 2));

    // Watch time score (hours per month → score)
    const watchTimeScore = Math.min(100, (watchTimeHours / 100) * 100);

    // Consistency score (based on upload regularity)
    const recentProjects = await prisma.videoProject.count({
      where: { channelId, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } },
    });
    const consistencyScore = Math.min(100, (recentProjects / 12) * 100);

    const growthScore = Math.round(
      ctrScore * VIRAL_WEIGHT +
      retentionScore * EVERGREEN_WEIGHT +
      subScore * SUB_GROWTH_WEIGHT +
      watchTimeScore * WATCH_TIME_WEIGHT +
      consistencyScore * CONSISTENCY_WEIGHT
    );

    let riskLevel: 'low' | 'medium' | 'high';
    if (growthScore >= 70) riskLevel = 'low';
    else if (growthScore >= 45) riskLevel = 'medium';
    else riskLevel = 'high';

    let scalingRecommendation: string;
    if (growthScore >= 80) {
      scalingRecommendation = 'SCALE_UP — Channel is performing well. Increase upload frequency, push viral content, expand topic clusters.';
    } else if (growthScore >= 60) {
      scalingRecommendation = 'STABILIZE — Channel is solid. Optimize hooks and retention, maintain consistent upload schedule.';
    } else if (growthScore >= 40) {
      scalingRecommendation = 'RESTRUCTURE — Channel needs improvement. Revise topic strategy, improve thumbnail/title quality, analyze top performers.';
    } else {
      scalingRecommendation = 'CRITICAL — Major restructuring needed. Consider channel pivot, new niche, or content format change.';
    }

    return {
      channelId,
      growthScore,
      avgCtr,
      avgRetention,
      subscriberGrowthRate: subscriberGrowth,
      watchTime: watchTimeHours,
      consistencyScore,
      riskLevel,
      scalingRecommendation,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 6: AUTONOMOUS DECISION SYSTEM
  // ────────────────────────────────────────────────────────────

  async decideStrategy(channelId: string): Promise<StrategyDecision> {
    logger.info(`[ChannelGrowth] Making strategic decision for ${channelId}`);

    const growthScore = await this.calculateChannelGrowthScore(channelId);
    const health = await this.analyzeChannelMetrics(channelId);

    let decisionType: 'SCALE_UP' | 'STABILIZE' | 'RESTRUCTURE';
    const actions: string[] = [];

    if (growthScore.growthScore >= 80) {
      decisionType = 'SCALE_UP';
      actions.push('Increase upload frequency by 1-2 videos per week');
      actions.push('Push more viral content (50% viral / 30% evergreen / 20% authority)');
      actions.push('Expand into adjacent topic clusters');
      actions.push('Invest in higher production thumbnails');
      actions.push('Test longer-form content for increased watch time');
    } else if (growthScore.growthScore >= 60) {
      decisionType = 'STABILIZE';
      actions.push('Maintain current upload frequency');
      actions.push('Optimize hook strength in first 10 seconds');
      actions.push('Improve retention via pattern interrupts and pacing variety');
      actions.push('A/B test thumbnail styles');
      actions.push('Analyze top 3 videos and replicate their structure');
    } else {
      decisionType = 'RESTRUCTURE';
      actions.push('Reduce upload frequency to focus on quality');
      actions.push('Shift topic cluster based on best-performing content');
      actions.push('Redesign thumbnail strategy');
      actions.push('Rewrite title approach — use curiosity gaps and power words');
      actions.push('Audience re-engagement: post community polls, analyze comments for topics');
      if (health.weakPoints.length > 0) {
        actions.push(...health.weakPoints.slice(0, 3).map(w => `Fix: ${w}`));
      }
    }

    // Record decision in DB
    try {
      await prisma.strategyDecision.create({
        data: {
          channelId,
          userId: (await prisma.channelMetrics.findFirst({ where: { channelId } }))?.userId || '',
          decisionType,
          growthScore: growthScore.growthScore,
          riskLevel: growthScore.riskLevel,
          reasoning: growthScore.scalingRecommendation,
          actions,
          applied: false,
        },
      });
    } catch { /* non-critical */ }

    return {
      channelId,
      decisionType,
      growthScore: growthScore.growthScore,
      riskLevel: growthScore.riskLevel,
      reasoning: growthScore.scalingRecommendation,
      actions,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 7: VIRAL VS EVERGREEN BALANCE CONTROLLER
  // ────────────────────────────────────────────────────────────

  async getContentMixRecommendationForChannel(channelId: string): Promise<ContentMixPlan> {
    logger.info(`[ChannelGrowth] Computing content mix for ${channelId}`);

    const mix = await this.getContentMixRecommendation(channelId);

    // Get topics for each category
    const viralOpps = await prisma.viralOpportunity.findMany({
      where: { viralScore: { gte: 65 }, saturationScore: { lt: 75 } },
      orderBy: { viralScore: 'desc' },
      take: 10,
    });

    const evergreenOpps = await prisma.viralOpportunity.findMany({
      where: { viralScore: { gte: 50, lt: 75 }, saturationScore: { lt: 60 } },
      orderBy: { viralScore: 'desc' },
      take: 10,
    });

    // Authority topics from existing winning patterns
    const authPatterns = await prisma.winningPattern.findMany({
      where: { category: 'viral-topic', score: { gte: 60 } },
      orderBy: { score: 'desc' },
      take: 5,
    });

    return {
      viralPct: mix.viralPct,
      evergreenPct: mix.evergreenPct,
      authorityPct: mix.authorityPct,
      viralTopics: viralOpps.map(o => o.topic),
      evergreenTopics: evergreenOpps.map(o => o.topic),
      authorityTopics: authPatterns.map(p => p.content).map(c => c.replace('Topic: ', '')),
    };
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 8: FAILURE DETECTION & CORRECTION LOOP
  // ────────────────────────────────────────────────────────────

  async detectAndCorrectDeclines(channelId: string): Promise<CorrectionAction[]> {
    logger.info(`[ChannelGrowth] Detecting declines for ${channelId}`);

    const corrections: CorrectionAction[] = [];

    try {
      const recentProjects = await prisma.videoProject.findMany({
        where: { channelId, status: 'published' },
        include: { analytics: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const ctrValues = recentProjects.map(p => p.analytics?.ctr || 0).filter(c => c > 0);
      const retentionValues = recentProjects.map(p => p.analytics?.retention || 0).filter(r => r > 0);

      // Detect CTR drop trend
      if (ctrValues.length >= 3) {
        const recentCtr = ctrValues.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
        const olderCtr = ctrValues.slice(3).reduce((a, b) => a + b, 0) / Math.max(1, ctrValues.length - 3);
        if (olderCtr > 0 && recentCtr < olderCtr * 0.8) {
          corrections.push({
            type: 'regenerate-title',
            severity: 'critical',
            metric: 'CTR',
            currentValue: recentCtr,
            threshold: olderCtr * 0.8,
            description: `CTR dropped ${Math.round((1 - recentCtr / olderCtr) * 100)}% vs older videos. Regenerate titles with stronger curiosity gaps and power words.`,
          });
        }
      }

      // Detect retention decay
      if (retentionValues.length >= 3) {
        const recentRet = retentionValues.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
        const olderRet = retentionValues.slice(3).reduce((a, b) => a + b, 0) / Math.max(1, retentionValues.length - 3);
        const retentionDrop = olderRet > 0 ? ((olderRet - recentRet) / olderRet) * 100 : 0;
        if (retentionDrop > 20) {
          corrections.push({
            type: 'adjust-hook',
            severity: 'critical',
            metric: 'Retention',
            currentValue: recentRet,
            threshold: olderRet * 0.8,
            description: `Retention dropped ${Math.round(retentionDrop)}%. Hooks and pacing structure need immediate attention. Add pattern interrupts in first 30 seconds.`,
          });
        }
        if (retentionDrop > 10 && retentionDrop <= 20) {
          corrections.push({
            type: 'change-pacing',
            severity: 'warning',
            metric: 'Retention',
            currentValue: recentRet,
            threshold: olderRet * 0.9,
            description: `Retention declining gradually (${Math.round(retentionDrop)}% drop). Add pacing variety and mini-cliffhangers.`,
          });
        }
      }

      // Detect topic fatigue (repeating low-performing topics)
      const topicPerformance = new Map<string, number[]>();
      for (const p of recentProjects) {
        const key = p.topic.split(/\s+/).slice(0, 3).join(' ').toLowerCase();
        if (!topicPerformance.has(key)) topicPerformance.set(key, []);
        if (p.analytics) topicPerformance.get(key)!.push(p.analytics.ctr || 0);
      }
      for (const [topic, ctrs] of topicPerformance) {
        if (ctrs.length >= 2 && ctrs.every(c => c < 2)) {
          corrections.push({
            type: 'shift-topic-cluster',
            severity: 'warning',
            metric: 'Topic',
            currentValue: ctrs.reduce((a, b) => a + b, 0) / ctrs.length,
            threshold: 2,
            description: `Topic cluster "${topic}" consistently underperforms (avg CTR < 2%). Shift to a different angle or subtopic.`,
          });
        }
      }

      // Detect audience saturation
      const channelMetrics = await prisma.channelMetrics.findFirst({ where: { channelId } });
      if (channelMetrics && channelMetrics.returningViewerPct > 80) {
        corrections.push({
          type: 'shift-topic-cluster',
          severity: 'info',
          metric: 'Returning viewers',
          currentValue: channelMetrics.returningViewerPct,
          threshold: 80,
          description: `Returning viewer rate is ${channelMetrics.returningViewerPct.toFixed(0)}% — audience may be saturated. Introduce new topics to attract fresh viewers.`,
        });
      }

      // Apply auto-fixes for critical issues
      if (corrections.some(c => c.severity === 'critical')) {
        logger.warn(`[ChannelGrowth] ${corrections.filter(c => c.severity === 'critical').length} critical corrections needed for ${channelId}`);
      }
    } catch (err: any) {
      logger.error(`[ChannelGrowth] Decline detection failed: ${err.message}`);
    }

    return corrections;
  }

  // ────────────────────────────────────────────────────────────
  //  UNIFIED GROWTH CYCLE
  // ────────────────────────────────────────────────────────────

  async runFullGrowthCycle(channelId: string): Promise<GrowthCycleReport> {
    logger.info(`[ChannelGrowth] Running full growth cycle for ${channelId}`);

    const timestamp = new Date();

    // Run all modules in parallel where possible
    const [healthReport, growthScore, strategyPlan, schedulePlan, corrections] = await Promise.all([
      this.analyzeChannelMetrics(channelId),
      this.calculateChannelGrowthScore(channelId),
      this.generateContentStrategy(channelId),
      this.optimizeUploadSchedule(channelId),
      this.detectAndCorrectDeclines(channelId),
    ]);

    // Decision depends on growth score
    const decision = await this.decideStrategy(channelId);

    // Persist growth snapshot
    const snapshot = await this.persistGrowthSnapshot(channelId, healthReport, growthScore, decision);

    logger.info(`[ChannelGrowth] Cycle complete for ${channelId}: score=${growthScore.growthScore}, trend=${healthReport.growthTrend}, decision=${decision.decisionType}`);

    return {
      channelId,
      timestamp,
      healthReport,
      growthScore,
      strategyPlan,
      schedulePlan,
      decision,
      corrections,
      snapshotId: snapshot?.id,
    };
  }

  private async persistGrowthSnapshot(
    channelId: string,
    health: ChannelHealthReport,
    score: GrowthScoreResult,
    decision: StrategyDecision,
  ): Promise<{ id: string } | null> {
    try {
      const channelMetrics = await prisma.channelMetrics.findFirst({ where: { channelId } });

      return await prisma.channelGrowthSnapshot.create({
        data: {
          channelId,
          userId: channelMetrics?.userId || '',
          growthScore: score.growthScore,
          avgCtr: score.avgCtr,
          avgRetention: score.avgRetention,
          subscriberGrowth: score.subscriberGrowthRate,
          watchTime: score.watchTime,
          consistencyScore: score.consistencyScore,
          channelHealth: health.channelHealthScore,
          growthTrend: health.growthTrend,
          riskLevel: score.riskLevel,
          scalingDecision: decision.decisionType,
          viralRatio: 40,
          evergreenRatio: 40,
          authorityRatio: 20,
          totalVideos: channelMetrics?.totalVideos || 0,
          totalViews: channelMetrics?.totalViews || 0,
          subscribers: channelMetrics?.subscribers || 0,
          metadata: {
            weakPoints: health.weakPoints,
            corrections: decision.actions,
            ctrTrend: health.ctrTrend,
            retentionTrend: health.retentionTrend,
          },
        },
      });
    } catch (err: any) {
      logger.warn(`[ChannelGrowth] Failed to persist snapshot: ${err.message}`);
      return null;
    }
  }

  // ────────────────────────────────────────────────────────────
  //  PUBLIC API METHODS
  // ────────────────────────────────────────────────────────────

  async getChannelHealthSummary(channelId: string): Promise<{
    latestSnapshot: any;
    trend: { growthScore: number; date: Date }[];
    decision: any | null;
  }> {
    const [latestSnapshot, snapshots, latestDecision] = await Promise.all([
      prisma.channelGrowthSnapshot.findFirst({ where: { channelId }, orderBy: { snapshotDate: 'desc' } }),
      prisma.channelGrowthSnapshot.findMany({ where: { channelId }, orderBy: { snapshotDate: 'asc' }, take: 30, select: { growthScore: true, snapshotDate: true } }),
      prisma.strategyDecision.findFirst({ where: { channelId }, orderBy: { decidedAt: 'desc' } }),
    ]);

    return {
      latestSnapshot,
      trend: snapshots.map(s => ({ growthScore: s.growthScore, date: s.snapshotDate })),
      decision: latestDecision,
    };
  }

  async getGrowthHistory(channelId: string, days = 30): Promise<{ date: string; score: number; health: number }[]> {
    const snapshots = await prisma.channelGrowthSnapshot.findMany({
      where: { channelId, snapshotDate: { gte: new Date(Date.now() - days * 86400000) } },
      orderBy: { snapshotDate: 'asc' },
    });
    return snapshots.map(s => ({
      date: s.snapshotDate.toISOString().split('T')[0],
      score: s.growthScore,
      health: s.channelHealth,
    }));
  }

  async getFailedPatterns(channelId?: string, limit = 20): Promise<{ pattern: string; reason: string; score: number }[]> {
    const where: Record<string, unknown> = {};
    if (channelId) where.channelId = channelId;
    const patterns = await prisma.failedPattern.findMany({
      where: where as any,
      orderBy: { detectedAt: 'desc' },
      take: limit,
    });
    return patterns.map(p => ({ pattern: p.patternValue, reason: p.failureReason, score: p.avgScore }));
  }
}
