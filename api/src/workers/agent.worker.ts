import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis';
import { queueLogger } from '../utils/logger';
import { prisma } from '../config/db';
import { generateVisualPrompts } from '../agents/prompt.agent';
import { createVoiceover } from '../agents/voiceover.agent';
import { generateThumbnail } from '../agents/thumbnail.agent';
import { optimizeSEO } from '../agents/seo.agent';


const worker = new Worker(
  'agent-tasks',
  async (job) => {
    queueLogger.info(`Processing agent job ${job.id} type=${job.name}`);
    await job.updateProgress(0);

    switch (job.name) {
      case 'prompt-generation': {
        const { scenes } = job.data as { scenes: { text: string; visualPrompt: string }[] };
        await job.updateProgress(20);
        const prompts = await generateVisualPrompts(scenes);
        await job.updateProgress(100);
        return { prompts };
      }

      case 'voiceover-generation': {
        const { text, projectId } = job.data as { text: string; projectId: string };
        await job.updateProgress(20);
        const result = await createVoiceover(text, projectId);
        await job.updateProgress(70);

        await prisma.voiceover.upsert({
          where: { projectId },
          update: {
            text: result.text,
            audioUrl: result.audioUrl,
            language: result.language,
            tone: result.tone,
            duration: result.duration,
            status: result.audioUrl ? 'completed' : 'failed',
          },
          create: {
            projectId,
            text: result.text,
            audioUrl: result.audioUrl,
            language: result.language,
            tone: result.tone,
            duration: result.duration,
            status: result.audioUrl ? 'completed' : 'failed',
          },
        });

        await job.updateProgress(100);
        return result;
      }

      case 'thumbnail-generation': {
        const { topic, hook, projectId } = job.data as { topic: string; hook: string; projectId: string };
        await job.updateProgress(20);
        const result = await generateThumbnail(topic, hook, projectId);
        await job.updateProgress(70);

        await prisma.thumbnail.upsert({
          where: { projectId },
          update: {
            prompt: result.prompt,
            imageUrl: result.imageUrl,
            style: result.style,
            status: result.imageUrl ? 'generated' : 'pending',
          },
          create: {
            projectId,
            prompt: result.prompt,
            imageUrl: result.imageUrl,
            style: result.style,
            status: result.imageUrl ? 'generated' : 'pending',
          },
        });

        await job.updateProgress(100);
        return result;
      }

      case 'seo-optimization': {
        const { topic, hook, projectId } = job.data as { topic: string; hook: string; projectId: string };
        await job.updateProgress(20);
        const result = await optimizeSEO(topic, hook);
        await job.updateProgress(70);

        if (projectId) {
          await prisma.videoProject.update({
            where: { id: projectId },
            data: { title: result.title, description: result.description },
          }).catch(err => queueLogger.error(`Failed to update project ${projectId} SEO metadata`, { error: (err as Error).message }));
        }

        await job.updateProgress(100);
        return result;
      }

      default:
        throw new Error(`Unknown agent task: ${job.name}`);
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
    lockDuration: 300_000,
    stalledInterval: 60_000,
  }
);

worker.on('completed', (job) => {
  queueLogger.info(`Agent job ${job.id} (${job.name}) completed`);
});

worker.on('failed', (job, err) => {
  queueLogger.error(`Agent job ${job?.id} (${job?.name}) failed`, { error: err.message });
});

worker.on('progress', (job, progress) => {
  queueLogger.debug(`Agent job ${job.id} (${job.name}) progress: ${progress}%`);
});

worker.on('error', (err) => {
  if (err.message.includes('SCRIPT') || err.message.includes('evalsha') || err.message.includes('NOSCRIPT')) {
    queueLogger.error('Agent worker FATAL Lua script error — worker shutting down', { error: err.message });
    worker.close();
    return;
  }
  queueLogger.error('Agent worker error', { error: err.message });
});

export { worker };
