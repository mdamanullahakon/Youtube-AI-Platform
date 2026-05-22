import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis';
import { queueLogger } from '../utils/logger';
import { AIOrchestrator } from '../ai/orchestrator';
import { prisma } from '../config/db';
import { guardWorker } from './worker-guard';

const worker = new Worker(
  'video-generation',
  async (job) => {
    queueLogger.info(`Processing video job ${job.id} type=${job.name}`);

    switch (job.name) {
      case 'full-pipeline': {
        await job.updateProgress(0);
        const { projectId, topic, userId, channelId } = job.data as {
          projectId: string;
          topic: string;
          userId?: string;
          channelId?: string;
        };
        const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
        const pipelineTopic = topic || project?.topic || 'trending topic';

        queueLogger.info(`[CanonicalPipeline] Job ${job.id} starting sync pipeline for project ${projectId}`);

        const orchestrator = new AIOrchestrator(
          projectId,
          channelId || project?.channelId || undefined,
          userId || project?.userId,
        );
        const result = await orchestrator.runFullPipeline(pipelineTopic);

        await job.updateProgress(100);
        queueLogger.info(`[CanonicalPipeline] Job ${job.id} finished for project ${projectId}`, {
          status: (result as { status?: string }).status,
        });
        return result;
      }

      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,
    lockDuration: 300_000,
    stalledInterval: 60_000,
  }
);

worker.on('completed', (job) => {
  queueLogger.info(`Video job ${job.id} (${job.name}) completed`);
});

worker.on('failed', (job, err) => {
  queueLogger.error(`Video job ${job?.id} (${job?.name}) failed`, { error: err.message });
});

worker.on('progress', (job, progress) => {
  queueLogger.debug(`Video job ${job.id} progress: ${progress}%`);
});

guardWorker(worker, 'video', (err) => {
  if (err.message.includes('SCRIPT') || err.message.includes('evalsha') || err.message.includes('NOSCRIPT')) {
    queueLogger.error('Video worker FATAL Lua script error — worker shutting down', { error: err.message });
  }
});

export { worker };
