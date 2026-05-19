import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { DailyOrchestrator } from './daily-orchestrator.service';
import { TopicEngine } from './topic-engine.service';
import { ContentGenerator } from './content-generator.service';
import { UploadEngine } from './upload-engine.service';
import { injectMonetization, updateMonetizationResult } from './monetization-engine.service';
import { LearningEngine } from './learning-engine.service';
import { assessCycleRisk, storeRiskAlerts } from './risk-engine.service';
import { getVideoAnalytics } from '../youtube.service';
import {
  INCOME_SYSTEM_QUEUES,
  IncomeTopicJobData,
  IncomeContentJobData,
  IncomeMonetizationJobData,
  IncomeUploadJobData,
  IncomeAnalyticsJobData,
  IncomeLearningJobData,
  IncomeRiskJobData,
  IncomeCycleJobData,
  IncomeChannelConfig,
  IncomeVideoPlan,
} from './types';
import {
  incomeTopicQueue, incomeContentQueue, incomeMonetizationQueue,
  incomeUploadQueue, incomeAnalyticsQueue, incomeLearningQueue,
  incomeRiskQueue, incomeCycleQueue,
} from './income.queue';

const orchestrator = new DailyOrchestrator();
const topicEngine = new TopicEngine();
const contentGenerator = new ContentGenerator();
const uploadEngine = new UploadEngine();
const learningEngine = new LearningEngine();

// ─── Topic Worker ─────────────────────────────
incomeTopicQueue.process(async (job) => {
  const data = job.data as IncomeTopicJobData;
  logger.info(`[IncomeTopic] Generating topics for ${data.channelId}`);
  const config = await prisma.incomeConfig.findUnique({ where: { channelId: data.channelId } });
  if (!config) throw new Error(`No config found for channel ${data.channelId}`);
  const channelConfig: IncomeChannelConfig = {
    channelId: config.channelId,
    userId: config.userId,
    niche: config.niche,
    videosPerDay: config.videosPerDay,
    uploadTimes: JSON.parse(config.uploadTimes),
    targetAudience: config.targetAudience,
    contentStyle: config.contentStyle,
    monetizationTypes: JSON.parse(config.monetizationTypes),
    riskThresholds: {
      minCtr: config.minCtrThreshold,
      minRetention: config.minRetentionThreshold,
      maxFailRate: config.maxFailRate,
    },
    enabled: config.enabled,
  };
  const topics = await topicEngine.selectTopics(channelConfig);
  return { channelId: data.channelId, topics: topics.map(t => ({ topic: t.topic, totalScore: t.totalScore })) };
});

// ─── Content Worker ───────────────────────────
incomeContentQueue.process(async (job) => {
  const data = job.data as IncomeContentJobData;
  logger.info(`[IncomeContent] Generating content for topic: ${data.topic}`);
  const config = await prisma.incomeConfig.findUnique({ where: { channelId: data.channelId } });
  if (!config) throw new Error(`No config for ${data.channelId}`);
  const channelConfig: IncomeChannelConfig = {
    channelId: config.channelId,
    userId: config.userId,
    niche: config.niche,
    videosPerDay: config.videosPerDay,
    uploadTimes: JSON.parse(config.uploadTimes),
    targetAudience: config.targetAudience,
    contentStyle: config.contentStyle,
    monetizationTypes: JSON.parse(config.monetizationTypes),
    riskThresholds: { minCtr: config.minCtrThreshold, minRetention: config.minRetentionThreshold, maxFailRate: config.maxFailRate },
    enabled: config.enabled,
  };
  const plan = await contentGenerator.generate({
    topicScore: {
      topic: data.topic,
      niche: data.niche,
      viralScore: data.viralScore,
      competitionScore: data.competitionScore,
      monetizationScore: data.monetizationScore,
      ctrPrediction: 0,
      retentionPrediction: 0,
      totalScore: data.totalScore,
      reasoning: '',
      source: 'ai-generated',
    },
    config: channelConfig,
    winnerPatterns: [],
  });
  return { planJson: JSON.stringify(plan), channelId: data.channelId, cycleId: data.cycleId };
});

// ─── Monetization Worker ──────────────────────
incomeMonetizationQueue.process(async (job) => {
  const data = job.data as IncomeMonetizationJobData;
  logger.info(`[IncomeMonetization] Injecting monetization for ${data.projectId}`);
  const plan: IncomeVideoPlan = JSON.parse(data.planJson);
  const enriched = await injectMonetization(plan);
  await updateMonetizationResult(data.projectId, JSON.stringify(enriched));
  return { projectId: data.projectId, estimatedRevenue: enriched.estimatedRevenue };
});

// ─── Upload Worker ────────────────────────────
incomeUploadQueue.process(async (job) => {
  const data = job.data as IncomeUploadJobData;
  logger.info(`[IncomeUpload] Uploading content for ${data.projectId}`);
  const plan: IncomeVideoPlan = JSON.parse(data.planJson);
  const result = await uploadEngine.upload(plan, data.projectId, data.cycleId);
  return { projectId: data.projectId, uploadStatus: result.uploadStatus, videoId: result.videoId };
});

// ─── Analytics Worker ─────────────────────────
incomeAnalyticsQueue.process(async (job) => {
  const data = job.data as IncomeAnalyticsJobData;
  logger.info(`[IncomeAnalytics] ${data.snapshotType} snapshot for ${data.projectId}`);

  try {
    const output = await prisma.incomeVideoOutput.findUnique({
      where: { projectId: data.projectId },
    });

    if (!output) {
      logger.warn(`[IncomeAnalytics] No output for ${data.projectId}`);
      return { warning: 'No output found' };
    }

    let videoId = output.videoId;
    let channelId = output.channelId;

    if (output.uploadStatus === 'processing' || !videoId || videoId.startsWith('pending_')) {
      const uploadHistory = await prisma.uploadHistory.findUnique({
        where: { projectId: data.projectId },
      });

      if (uploadHistory?.videoId) {
        videoId = uploadHistory.videoId;
        channelId = uploadHistory.channelId || channelId;

        await prisma.incomeVideoOutput.update({
          where: { projectId: data.projectId },
          data: { uploadStatus: 'uploaded', videoId, publishedAt: uploadHistory.publishedAt },
        });
      } else {
        logger.warn(`[IncomeAnalytics] Video not yet uploaded for ${data.projectId}, storing placeholder`);
      }
    }

    let views = 0, likes = 0, comments = 0, shares = 0;
    let ctr = 0, retention = 0, watchTime = 0;
    let subscribersGained = 0, impressions = 0, avgViewDuration = 0;

    if (videoId && !videoId.startsWith('pending_')) {
      try {
        const stats = await getVideoAnalytics(videoId);
        if (stats) {
          views = stats.views ?? 0;
          likes = stats.likes ?? 0;
          comments = stats.comments ?? 0;
          shares = stats.shares ?? 0;
          ctr = stats.ctr ?? 0;
          retention = stats.retention ?? 0;
          watchTime = stats.watchTime ?? 0;
          subscribersGained = stats.subscribersGained ?? 0;
          impressions = stats.impressions ?? 0;
          avgViewDuration = stats.avgViewDuration ?? 0;
        }
      } catch (err: any) {
        logger.warn(`[IncomeAnalytics] getVideoAnalytics failed for ${videoId}: ${err.message}`);
      }
    }

    await prisma.incomeAnalyticsSnapshot.create({
      data: {
        projectId: data.projectId,
        videoId: videoId || data.videoId,
        channelId,
        snapshotType: data.snapshotType,
        minutesSinceUpload: data.delayMinutes,
        views, likes, comments, shares,
        ctr, retention, watchTime,
        subscribersGained, impressions, avgViewDuration,
        collectedAt: new Date(),
      },
    });

    logger.info(`[IncomeAnalytics] ${data.snapshotType} snapshot for ${data.projectId}: ${views} views, ${ctr}% CTR`);

    // Trigger 12-hour decision on full analytics
    if (data.snapshotType === 'full') {
      try {
        const cycleId = `cycle_${channelId}_${new Date().toISOString().split('T')[0]}`;
        await learningEngine.run12HourDecision(cycleId, channelId);
      } catch (err: any) {
        logger.warn(`[IncomeAnalytics] 12h decision trigger failed: ${err.message}`);
      }
    }

    return { projectId: data.projectId, snapshotType: data.snapshotType, views };
  } catch (err: any) {
    logger.error(`[IncomeAnalytics] Failed for ${data.projectId}: ${err.message}`);
    throw err;
  }
});

// ─── Learning Worker ──────────────────────────
incomeLearningQueue.process(async (job) => {
  const data = job.data as IncomeLearningJobData;
  logger.info(`[IncomeLearning] Detecting winners for ${data.channelId} (cycle: ${data.cycleId})`);
  const winner = await learningEngine.detectBestVideo(data.channelId, data.cycleId);
  if (winner) {
    await learningEngine.extractPatterns(winner);
    logger.info(`[IncomeLearning] Winner detected: ${winner.projectId} (score: ${winner.score})`);
  } else {
    logger.info(`[IncomeLearning] No clear winner for cycle ${data.cycleId}`);
  }
  return { channelId: data.channelId, cycleId: data.cycleId, hasWinner: !!winner };
});

// ─── Risk Worker ──────────────────────────────
incomeRiskQueue.process(async (job) => {
  const data = job.data as IncomeRiskJobData;
  logger.info(`[IncomeRisk] Assessing risk for ${data.channelId} (cycle: ${data.cycleId})`);
  const alerts = await assessCycleRisk(data.channelId, data.cycleId, data.cycleLogId);
  await storeRiskAlerts(alerts);
  logger.info(`[IncomeRisk] ${alerts.length} alerts for cycle ${data.cycleId}`);
  return { channelId: data.channelId, cycleId: data.cycleId, alertCount: alerts.length };
});

// ─── Cycle Worker ─────────────────────────────
incomeCycleQueue.process(async (job) => {
  logger.info(`[IncomeCycle] Starting daily cycle for ${job.data.channelId}`);
  const data = job.data as IncomeCycleJobData;
  const config: IncomeChannelConfig = JSON.parse(data.configJson);
  const result = await orchestrator.runDailyCycle(config);

  return {
    channelId: data.channelId,
    videosPlanned: result.videosPlanned,
    videosUploaded: result.videosUploaded,
    status: 'completed',
  };
});

export const incomeWorkers = [] as const;

export async function closeAllIncomeWorkers(): Promise<void> {
  // No-op for InMemoryQueue; queues closed separately
}
