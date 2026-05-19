import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { TopicEngine } from './topic-engine.service';
import { ContentGenerator } from './content-generator.service';
import { UploadEngine } from './upload-engine.service';
import { injectMonetization, updateMonetizationResult } from './monetization-engine.service';
import { LearningEngine } from './learning-engine.service';
import { assessCycleRisk, storeRiskAlerts } from './risk-engine.service';
import { incomeLearningQueue, incomeRiskQueue, incomeAnalyticsQueue } from './income.queue';
import {
  IncomeChannelConfig,
  IncomeCycleResult,
  IncomeVideoPlan,
  IncomeUploadResult,
  IncomeTopicScore,
  IncomeWinningPattern,
  IncomeAnalyticsJobData,
  IncomeLearningJobData,
  IncomeRiskJobData,
  EARLY_ANALYTICS_DELAY_MIN,
  FULL_ANALYTICS_DELAY_MIN,
} from './types';

export class DailyOrchestrator {
  private topicEngine: TopicEngine;
  private contentGenerator: ContentGenerator;
  private uploadEngine: UploadEngine;
  private learningEngine: LearningEngine;

  constructor() {
    this.topicEngine = new TopicEngine();
    this.contentGenerator = new ContentGenerator();
    this.uploadEngine = new UploadEngine();
    this.learningEngine = new LearningEngine();
  }

  async runDailyCycle(config: IncomeChannelConfig): Promise<IncomeCycleResult> {
    const date = new Date().toISOString().split('T')[0];
    const cycleId = `cycle_${config.channelId}_${date}`;
    logger.info(`[DailyOrchestrator] Starting cycle ${cycleId} for channel ${config.channelId}`);

    const cycleLog = await prisma.incomeCycleLog.create({
      data: {
        channelId: config.channelId,
        userId: config.userId,
        cycleDate: date,
        status: 'running',
      },
    });

    let winnerPatterns: IncomeWinningPattern[] = [];
    try {
      winnerPatterns = await this.loadWinnerPatterns(config.channelId, config.niche);
    } catch (err: any) {
      logger.warn(`[DailyOrchestrator] Failed to load winner patterns: ${err.message}`);
    }

    let topics: IncomeTopicScore[] = [];
    try {
      topics = await this.topicEngine.selectTopics(config);
    } catch (err: any) {
      logger.error(`[DailyOrchestrator] Topic selection failed: ${err.message}`);
    }
    if (topics.length === 0) {
      logger.warn('[DailyOrchestrator] No topics available, using fallback');
      topics = [{ topic: config.niche || 'general', niche: config.niche, viralScore: 50, competitionScore: 50, monetizationScore: 0, ctrPrediction: 0, retentionPrediction: 0, totalScore: 50, reasoning: 'fallback', source: 'ai-generated' }];
    }
    logger.info(`[DailyOrchestrator] Selected ${topics.length} topics`);

    const plans: IncomeVideoPlan[] = [];
    const uploadResults: IncomeUploadResult[] = [];

    for (const topicScore of topics) {
      try {
        const plan = await this.contentGenerator.generate({
          topicScore,
          config,
          winnerPatterns,
        });

        const enrichedPlan = await injectMonetization(plan);
        plans.push(enrichedPlan);

        const projectId = `income_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const result = await this.uploadEngine.upload(enrichedPlan, projectId, cycleId);

        await updateMonetizationResult(projectId, JSON.stringify(enrichedPlan));

        if (result.uploadStatus !== 'failed' && result.projectId) {
          logger.info(`[DailyOrchestrator] Enqueued "${enrichedPlan.title}" for pipeline processing`);
        }

        if (result.uploadStatus !== 'failed') {
          try {
            await incomeAnalyticsQueue.add('collect-early-analytics', {
              projectId: result.projectId,
              videoId: result.videoId || '',
              channelId: config.channelId,
              snapshotType: 'early',
              delayMinutes: EARLY_ANALYTICS_DELAY_MIN,
            } satisfies IncomeAnalyticsJobData, {
              delay: EARLY_ANALYTICS_DELAY_MIN * 60 * 1000,
            });

            await incomeAnalyticsQueue.add('collect-full-analytics', {
              projectId: result.projectId,
              videoId: result.videoId || '',
              channelId: config.channelId,
              snapshotType: 'full',
              delayMinutes: FULL_ANALYTICS_DELAY_MIN,
            } satisfies IncomeAnalyticsJobData, {
              delay: FULL_ANALYTICS_DELAY_MIN * 60 * 1000,
            });

            logger.info(`[DailyOrchestrator] Scheduled analytics for "${enrichedPlan.title}" (30min + 12hr)`);
          } catch (err: any) {
            logger.warn(`[DailyOrchestrator] Failed to enqueue analytics for ${result.projectId}: ${err.message}`);
          }
        }

        uploadResults.push(result);
        logger.info(`[DailyOrchestrator] "${enrichedPlan.title}": ${result.uploadStatus}`);
      } catch (err: any) {
        logger.error(`[DailyOrchestrator] Failed topic "${topicScore.topic}": ${err.message}`);
        uploadResults.push({
          projectId: '',
          videoId: null,
          uploadStatus: 'failed',
          publishedAt: null,
          error: err.message,
        });
      }
    }

    const uploaded = uploadResults.filter(r => r.uploadStatus === 'uploaded' || r.uploadStatus === 'processing').length;
    const failed = uploadResults.filter(r => r.uploadStatus === 'failed').length;

    const totalEstimatedRevenue = plans.reduce((sum, p) => sum + (p.estimatedRevenue || 0), 0);

    await prisma.incomeCycleLog.update({
      where: { id: cycleLog.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        videosPlanned: topics.length,
        videosUploaded: uploaded,
        videosFailed: failed,
        totalEstimatedRevenue,
      },
    });

    // Enqueue learning (delayed to let 30-min analytics arrive first)
    try {
      await incomeLearningQueue.add('detect-winners', {
        channelId: config.channelId,
        cycleId,
        date,
      } satisfies IncomeLearningJobData, {
        delay: (EARLY_ANALYTICS_DELAY_MIN + 5) * 60 * 1000,
      });
    } catch (err: any) {
      logger.warn(`[DailyOrchestrator] Failed to enqueue learning job: ${err.message}`);
    }

    // Enqueue risk assessment
    try {
      await incomeRiskQueue.add('assess-risk', {
        channelId: config.channelId,
        userId: config.userId,
        niche: config.niche,
        cycleId,
        cycleLogId: cycleLog.id,
      } satisfies IncomeRiskJobData);
    } catch (err: any) {
      logger.warn(`[DailyOrchestrator] Failed to enqueue risk job: ${err.message}`);
    }

    logger.info(`[DailyOrchestrator] Cycle ${cycleId} done: ${uploaded}/${topics.length} uploaded, $${totalEstimatedRevenue.toFixed(2)} est. revenue`);
    return {
      cycleId,
      channelId: config.channelId,
      userId: config.userId,
      date,
      videosPlanned: topics.length,
      videosUploaded: uploaded,
      videosFailed: failed,
      totalEstimatedRevenue,
      riskFlags: [],
      completedAt: new Date(),
    };
  }

  private async loadWinnerPatterns(
    channelId: string,
    niche: string,
  ): Promise<IncomeWinningPattern[]> {
    const patterns = await prisma.incomeWinnerPattern.findMany({
      where: { channelId, confidence: { gte: 0.3 } },
      orderBy: { score: 'desc' },
      take: 20,
    });

    const nichePatterns = await prisma.incomeWinnerPattern.findMany({
      where: { niche, channelId: null, confidence: { gte: 0.5 } },
      orderBy: { score: 'desc' },
      take: 10,
    });

    return [
      ...patterns.map(p => ({
        patternType: p.patternType as IncomeWinningPattern['patternType'],
        patternValue: p.patternValue,
        niche: p.niche,
        score: p.score,
        sampleSize: p.sampleSize,
        avgViews: p.avgViews,
        avgCtr: p.avgCtr,
        avgRetention: p.avgRetention,
        confidence: p.confidence,
      })),
      ...nichePatterns.map(p => ({
        patternType: p.patternType as IncomeWinningPattern['patternType'],
        patternValue: p.patternValue,
        niche: p.niche,
        score: p.score,
        sampleSize: p.sampleSize,
        avgViews: p.avgViews,
        avgCtr: p.avgCtr,
        avgRetention: p.avgRetention,
        confidence: p.confidence,
      })),
    ];
  }
}
