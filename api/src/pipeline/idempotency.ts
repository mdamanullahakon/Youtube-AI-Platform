import { redisConnection } from '../config/redis';
import { prisma } from '../config/db';
import { pipelineLogger } from '../utils/logger';

export const IDEMPOTENCY_PREFIX = 'idempotency:';
export const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getStepLockKey(jobId: string, stepName: string): string {
  return `${IDEMPOTENCY_PREFIX}job:${jobId}:step:${stepName}`;
}

function getJobLockKey(jobId: string): string {
  return `${IDEMPOTENCY_PREFIX}job:${jobId}:lock`;
}

export async function checkStepIdempotency(jobId: string, stepName: string): Promise<boolean> {
  const key = getStepLockKey(jobId, stepName);
  try {
    const result = await redisConnection.set(key, Date.now().toString(), 'PX', IDEMPOTENCY_TTL_MS, 'NX');
    if (result === 'OK') {
      return false;
    }
    const existingValue = await redisConnection.get(key);
    pipelineLogger.warn(`Idempotency check: step ${stepName} for job ${jobId} already executed at ${existingValue}`);
    return true;
  } catch {
    return false;
  }
}

export async function markStepCompleted(jobId: string, stepName: string): Promise<void> {
  const key = getStepLockKey(jobId, stepName);
  try {
    await redisConnection.set(key, Date.now().toString(), 'PX', IDEMPOTENCY_TTL_MS);
  } catch {
  }
}

export async function acquireJobLock(jobId: string, ttlMs: number = 300_000): Promise<boolean> {
  const key = getJobLockKey(jobId);
  try {
    const result = await redisConnection.set(key, Date.now().toString(), 'PX', ttlMs, 'NX');
    return result === 'OK';
  } catch {
    return true;
  }
}

export async function releaseJobLock(jobId: string): Promise<void> {
  const key = getJobLockKey(jobId);
  try {
    await redisConnection.del(key);
  } catch {
  }
}

export async function extendJobLock(jobId: string, ttlMs: number = 300_000): Promise<void> {
  const key = getJobLockKey(jobId);
  try {
    await redisConnection.pexpire(key, ttlMs);
  } catch {
  }
}

export async function verifyNoDuplicateOutputs(projectId: string): Promise<string[]> {
  const duplicates: string[] = [];
  try {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        uploadHistory: true,
        script: true,
        videoRender: true,
        voiceover: true,
        analytics: true,
      },
    });
    if (!project) return duplicates;

    const checks: { name: string; exists: boolean }[] = [
      { name: 'uploadHistory', exists: !!project.uploadHistory?.videoId },
      { name: 'script', exists: !!project.script?.content },
      { name: 'videoRender', exists: !!project.videoRender?.videoUrl },
    ];

    for (const check of checks) {
      if (check.exists) {
        duplicates.push(`Duplicate ${check.name} found for project ${projectId}`);
      }
    }
  } catch {
  }
  return duplicates;
}

export function buildStepCompleteKey(projectId: string, stepName: string): string {
  return `pipeline:${projectId}:step:${stepName}`;
}

export async function isPipelineStepComplete(projectId: string, stepName: string): Promise<boolean> {
  const key = buildStepCompleteKey(projectId, stepName);
  try {
    const val = await redisConnection.get(key);
    return val !== null;
  } catch {
    return false;
  }
}

export async function markPipelineStepComplete(projectId: string, stepName: string, output: string): Promise<void> {
  const key = buildStepCompleteKey(projectId, stepName);
  try {
    await redisConnection.set(key, output, 'PX', IDEMPOTENCY_TTL_MS);
  } catch {
  }
}
