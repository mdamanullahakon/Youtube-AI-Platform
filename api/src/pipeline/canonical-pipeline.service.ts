import { prisma } from '../config/db';
import { videoQueue } from '../queues/video.queue';
import { pipelineLogger } from '../utils/logger';
import { AIOrchestrator } from '../ai/orchestrator';

/** Production pipeline: sync PipelineOrchestrator only (via video-generation queue or direct run). */
export const CANONICAL_PIPELINE_JOB = 'full-pipeline';

export async function enqueueCanonicalPipeline(
  projectId: string,
  topic: string,
  options?: { userId?: string; channelId?: string },
): Promise<string | undefined> {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    select: { userId: true, channelId: true, topic: true },
  });
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  await prisma.videoProject.update({
    where: { id: projectId },
    data: { status: 'running', topic: topic || project.topic },
  });

  const job = await videoQueue.add(CANONICAL_PIPELINE_JOB, {
    projectId,
    topic: topic || project.topic,
    userId: options?.userId || project.userId,
    channelId: options?.channelId || project.channelId || undefined,
  });

  pipelineLogger.info(`[CanonicalPipeline] Enqueued job ${job.id} for project ${projectId}`);
  return job.id;
}

/** Run sync pipeline in-process (cron / tests). */
export async function runCanonicalPipeline(
  projectId: string,
  topic: string,
  options?: { userId?: string; channelId?: string },
): Promise<Record<string, unknown>> {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    select: { userId: true, channelId: true },
  });
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  await prisma.videoProject.update({
    where: { id: projectId },
    data: { status: 'running' },
  });

  const orchestrator = new AIOrchestrator(
    projectId,
    options?.channelId || project.channelId || undefined,
    options?.userId || project.userId,
  );
  return orchestrator.runFullPipeline(topic);
}

export function isIncomeSystemEnabled(): boolean {
  return process.env.ENABLE_INCOME_SYSTEM_V2 === 'true';
}

export function isLegacyQueuePipelineEnabled(): boolean {
  return process.env.ENABLE_LEGACY_QUEUE_PIPELINE === 'true';
}
