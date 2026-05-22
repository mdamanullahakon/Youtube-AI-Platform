import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis';
import { queueLogger } from '../utils/logger';
import { prisma } from '../config/db';
import { generateScript } from '../agents/script.agent';

const worker = new Worker(
  'script-generation',
  async (job) => {
    queueLogger.info(`Processing script generation job ${job.id}`);
    await job.updateProgress(0);

    const { topic, format, projectId } = job.data as { topic: string; format?: string; projectId?: string };

    await job.updateProgress(20);
    const script = await generateScript(topic, format || 'Shorts');
    await job.updateProgress(50);

    if (projectId) {
      await prisma.script.upsert({
        where: { projectId },
        update: {
          content: script.content,
          hook: script.hook,
          wordCount: script.wordCount,
          tone: script.tone,
          targetLength: format,
          generatedBy: 'ai-agent',
        },
        create: {
          projectId,
          content: script.content,
          hook: script.hook,
          wordCount: script.wordCount,
          tone: script.tone,
          targetLength: format,
          generatedBy: 'ai-agent',
        },
      });

      await prisma.videoProject.update({
        where: { id: projectId },
        data: { status: 'script_generated' },
      }).catch(err => queueLogger.error(`Failed to update project ${projectId} status to script_generated`, { error: (err as Error).message }));

      // Production uses sync PipelineOrchestrator — do not dispatch parallel agent jobs (voice/render race).
      queueLogger.info(
        `Script saved for project ${projectId}. Use canonical pipeline (video-generation/full-pipeline) for end-to-end processing.`,
      );
    }

    await job.updateProgress(100);
    queueLogger.info(`Script generated for: ${script.hook?.substring(0, 60)}...`);
    return script;
  },
  {
    connection: redisConnection,
    concurrency: 1,
    lockDuration: 600_000,
    stalledInterval: 120_000,
  }
);

worker.on('completed', (job) => {
  queueLogger.info(`Script job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  queueLogger.error(`Script job ${job?.id} failed`, { error: err.message });
});

worker.on('progress', (job, progress) => {
  queueLogger.debug(`Script job ${job.id} progress: ${progress}%`);
});

worker.on('error', (err) => {
  if (err.message.includes('SCRIPT') || err.message.includes('evalsha') || err.message.includes('NOSCRIPT')) {
    queueLogger.error('Script worker FATAL Lua script error — worker shutting down', { error: err.message });
    worker.close();
    return;
  }
  queueLogger.error('Script worker error', { error: err.message });
});

export { worker };
