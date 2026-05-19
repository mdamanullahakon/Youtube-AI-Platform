import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis';
import { queueLogger } from '../utils/logger';
import { prisma } from '../config/db';
import { generateScript } from '../agents/script.agent';
import { agentQueue } from '../queues/video.queue';
import { parseScriptScenes } from '../utils/helpers';
import { checkStepIdempotency, markStepCompleted } from '../pipeline/idempotency';

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

      // Idempotent agent dispatch — skip if already dispatched for this job
      const agentDispatchKey = `agent-dispatch:${job.id}`;
      const alreadyDispatched = await checkStepIdempotency(job.id || projectId, 'agent-dispatch');
      if (!alreadyDispatched) {
        const scenes = parseScriptScenes(script.content);
        const scenesForPrompt = scenes.map(s => ({ text: s.text, visualPrompt: s.visualPrompt }));

        await agentQueue.addBulk([
          { name: 'prompt-generation', data: { scenes: scenesForPrompt, projectId }, opts: { deduplication: { id: `prompt:${projectId}`, ttl: 86400000 } } },
          { name: 'voiceover-generation', data: { text: script.content, projectId }, opts: { deduplication: { id: `voiceover:${projectId}`, ttl: 86400000 } } },
          { name: 'thumbnail-generation', data: { topic, hook: script.hook || '', projectId }, opts: { deduplication: { id: `thumbnail:${projectId}`, ttl: 86400000 } } },
          { name: 'seo-optimization', data: { topic, hook: script.hook || '', projectId }, opts: { deduplication: { id: `seo:${projectId}`, ttl: 86400000 } } },
        ]);

        queueLogger.info(`Dispatched 4 agent tasks for project ${projectId}`);
        await markStepCompleted(job.id || projectId, 'agent-dispatch');
      } else {
        queueLogger.info(`Agent tasks already dispatched for job ${job.id} — skipping`);
      }
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
