import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis';
import { queueLogger } from '../utils/logger';
import { prisma } from '../config/db';
import { analyzeTrend } from '../agents/trend.agent';

const worker = new Worker(
  'trend-analysis',
  async (job) => {
    queueLogger.info(`Processing trend analysis job ${job.id}`);
    await job.updateProgress(0);

    const { projectId } = job.data as { projectId?: string };

    await job.updateProgress(10);
    let analysis;
    try {
      analysis = await analyzeTrend();
    } catch (err: any) {
      queueLogger.error(`Trend analysis AI failed, using fallback`, { error: err.message });
      analysis = {
        topic: job.data.topic || 'trending topic',
        viralScore: 50,
        competition: 30,
        audience: 'General',
        format: 'Shorts',
        trends: [],
        competitors: [],
        reasoning: 'Fallback after AI failure',
      };
    }
    await job.updateProgress(60);

    if (projectId) {
      await prisma.trendResearch.upsert({
        where: { projectId },
        update: {
          topic: analysis.topic,
          viralScore: analysis.viralScore,
          competition: analysis.competition,
          audience: analysis.audience,
          format: analysis.format,
          trends: analysis.trends as any,
          competitors: analysis.competitors as any,
          source: 'multi-source',
        },
        create: {
          projectId,
          topic: analysis.topic,
          viralScore: analysis.viralScore,
          competition: analysis.competition,
          audience: analysis.audience,
          format: analysis.format,
          trends: analysis.trends as any,
          competitors: analysis.competitors as any,
          source: 'multi-source',
        },
      });

      await prisma.videoProject.update({
        where: { id: projectId },
        data: {
          status: 'trending_analyzed',
          topic: analysis.topic,
          viralScore: analysis.viralScore,
          competition: analysis.competition,
          audience: analysis.audience,
          format: analysis.format,
        },
      }).catch(err => queueLogger.error(`Failed to update project ${projectId} trend analysis status`, { error: (err as Error).message }));
    }

    await job.updateProgress(100);
    queueLogger.info(`Trend analysis complete: ${analysis.topic}`);
    // Ensure serializable return value
    const safeResult = { topic: analysis.topic, viralScore: analysis.viralScore, competition: analysis.competition, audience: analysis.audience, format: analysis.format };
    return safeResult;
  },
  {
    connection: redisConnection,
    concurrency: 1,
    lockDuration: 300_000,
    stalledInterval: 60_000,
  }
);

worker.on('completed', (job) => {
  queueLogger.info(`Trend job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  queueLogger.error(`Trend job ${job?.id} failed`, { error: err.message });
});

worker.on('progress', (job, progress) => {
  queueLogger.debug(`Trend job ${job.id} progress: ${progress}%`);
});

worker.on('error', (err) => {
  if (err.message.includes('SCRIPT') || err.message.includes('evalsha') || err.message.includes('NOSCRIPT')) {
    queueLogger.error('Trend worker FATAL Lua script error — worker shutting down', { error: err.message });
    worker.close();
    return;
  }
  queueLogger.error('Trend worker error', { error: err.message });
});

export { worker };
