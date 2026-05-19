import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';
import { getVideoAnalytics } from '../services/youtube.service';
import { prisma } from '../config/db';
import { AnalyticsLearningService } from '../services/analytics-learning.service';
import { CTRAnalyzer } from '../services/ctr-analyzer.service';


const analyticsLearning = new AnalyticsLearningService();
const ctrAnalyzer = new CTRAnalyzer();

const worker = new Worker(
  'analytics-collection',
  async (job) => {
    logger.info(`Processing analytics job ${job.id}`);
    await job.updateProgress(0);

    const { projectId } = job.data as { projectId: string };

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: { uploadHistory: true },
    });

    if (!project?.uploadHistory?.videoId) {
      logger.warn(`No video ID for project ${projectId}`);
      await job.updateProgress(100);
      return { warning: 'No video ID found' };
    }

    await job.updateProgress(20);
    const stats = await getVideoAnalytics(project.uploadHistory.videoId);

    await job.updateProgress(40);

    if (stats) {
      await prisma.analytics.upsert({
        where: { projectId },
        update: {
          views: stats.views,
          likes: stats.likes,
          comments: stats.comments,
          ctr: stats.ctr,
          retention: stats.retention,
          watchTime: stats.watchTime,
          subscribersGained: stats.subscribersGained,
          collectedAt: new Date(),
        },
        create: {
          projectId,
          views: stats.views,
          likes: stats.likes,
          comments: stats.comments,
          ctr: stats.ctr,
          retention: stats.retention,
          watchTime: stats.watchTime,
          subscribersGained: stats.subscribersGained,
          collectedAt: new Date(),
        },
      });
      logger.info(`Analytics updated for project ${projectId}`);
    }

    await job.updateProgress(60);

    if (stats && stats.ctr > 0) {
      await ctrAnalyzer.updateWithActualCTR(projectId, stats.ctr, 0);
    }

    await job.updateProgress(75);

    try {
      await analyticsLearning.analyzeProject({
        projectId,
        enhanceWithAI: true,
      });
      logger.info(`Analytics learning completed for project ${projectId}`);
    } catch (learningError) {
      logger.error(`Analytics learning failed for project ${projectId}`, {
        error: (learningError as Error).message,
      });
    }

    await job.updateProgress(100);
    return { projectId, collected: !!stats };
  },
  {
    connection: redisConnection,
    concurrency: 1,
    lockDuration: 300_000,
    stalledInterval: 60_000,
  }
);

worker.on('completed', (job) => logger.info(`Analytics job ${job.id} completed`));
worker.on('failed', (job, err) => logger.error(`Analytics job ${job?.id} failed`, { error: err.message }));
worker.on('progress', (job, progress) => logger.debug(`Analytics job ${job.id} progress: ${progress}%`));
worker.on('error', (err) => {
  if (err.message.includes('SCRIPT') || err.message.includes('evalsha') || err.message.includes('NOSCRIPT')) {
    logger.error('Analytics worker FATAL Lua script error — worker shutting down', { error: err.message });
    worker.close();
    return;
  }
  logger.error('Analytics worker error', { error: err.message });
});

export { worker };
