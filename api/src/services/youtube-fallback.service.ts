import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { classifyOAuthError, formatOAuthErrorForUser } from '../utils/oauth-error-classifier';
import { redisConnection } from '../config/redis';
import path from 'path';
import fs from 'fs';

export type FallbackReason =
  | 'deleted_client'
  | 'redirect_uri_mismatch'
  | 'scope_permission'
  | 'consent_screen'
  | 'quota_disabled'
  | 'token_expired'
  | 'unknown_oauth'
  | 'no_credentials';

export type FallbackMode = 'full' | 'partial' | 'manual_only';

interface FallbackState {
  active: boolean;
  mode: FallbackMode;
  reason: FallbackReason | null;
  activatedAt: string | null;
  lastError: string | null;
  queuedCount: number;
  exportedCount: number;
}

const FALLBACK_LOCK_KEY = 'youtube:fallback:active';
const FALLBACK_META_KEY = 'youtube:fallback:meta';
const FALLBACK_EXPORT_DIR = path.join(process.cwd(), 'uploads', 'export');

const RETRY_SCHEDULES = [
  { label: '1h', ms: 60 * 60 * 1000 },
  { label: '6h', ms: 6 * 60 * 60 * 1000 },
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
];

function ensureExportDir(): void {
  if (!fs.existsSync(FALLBACK_EXPORT_DIR)) {
    fs.mkdirSync(FALLBACK_EXPORT_DIR, { recursive: true });
  }
}

export async function getFallbackState(): Promise<FallbackState> {
  const active = await redisConnection.get(FALLBACK_LOCK_KEY);
  const metaRaw = await redisConnection.get(FALLBACK_META_KEY);
  const meta = metaRaw ? JSON.parse(metaRaw) : {};

  const queued = await prisma.uploadHistory.count({
    where: { status: 'fallback_queued' },
  });

  return {
    active: active === '1',
    mode: meta.mode || 'partial',
    reason: meta.reason || null,
    activatedAt: meta.activatedAt || null,
    lastError: meta.lastError || null,
    queuedCount: queued,
    exportedCount: meta.exportedCount || 0,
  };
}

export async function activateFallback(
  reason: FallbackReason,
  error: any,
): Promise<void> {
  const classified = classifyOAuthError(error);
  const isAuthError = classified.type !== 'E_quota_disabled' && classified.type !== 'G_unknown';

  const mode: FallbackMode = isAuthError ? 'partial' : 'manual_only';

  await redisConnection.set(FALLBACK_LOCK_KEY, '1', 'PX', 365 * 24 * 60 * 60 * 1000);

  const meta = {
    mode,
    reason,
    activatedAt: new Date().toISOString(),
    lastError: classified.title,
    exportedCount: 0,
  };
  await redisConnection.set(FALLBACK_META_KEY, JSON.stringify(meta));

  logger.warn(`[FALLBACK] YouTube fallback activated`, {
    mode,
    reason,
    errorType: classified.type,
  });

  console.log(formatOAuthErrorForUser(classified));
}

export async function deactivateFallback(): Promise<void> {
  await redisConnection.del(FALLBACK_LOCK_KEY);
  await redisConnection.del(FALLBACK_META_KEY);
  logger.info('[FALLBACK] YouTube fallback deactivated — YouTube connection restored');
}

export async function isFallbackActive(): Promise<boolean> {
  return (await redisConnection.get(FALLBACK_LOCK_KEY)) === '1';
}

export async function queueUploadForFallback(
  projectId: string,
  userId: string,
): Promise<void> {
  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: {
      videoRender: true,
      thumbnail: true,
      script: true,
    },
  });
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }
  if (!project.videoRender?.videoUrl) {
    throw new Error(`Project ${projectId} has no rendered video. Complete the render step first.`);
  }

  const fallbackState = await getFallbackState();

  await prisma.uploadHistory.upsert({
    where: { projectId },
    create: {
      projectId,
      userId,
      channelId: project.channelId || undefined,
      title: project.title || undefined,
      description: project.description || undefined,
      tags: '',
      status: 'fallback_queued',
      error: JSON.stringify({
        fallbackReason: fallbackState.reason,
        fallbackMode: fallbackState.mode,
        queuedAt: new Date().toISOString(),
      }),
    },
    update: {
      status: 'fallback_queued',
      error: JSON.stringify({
        fallbackReason: fallbackState.reason,
        fallbackMode: fallbackState.mode,
        queuedAt: new Date().toISOString(),
      }),
    },
  });

  await prisma.videoProject.update({
    where: { id: projectId },
    data: { status: 'fallback_queued' },
  });

  logger.info(`[FALLBACK] Upload queued for project ${projectId}`, {
    title: project.title,
    reason: fallbackState.reason,
  });
}

export async function getQueuedUploads(userId?: string) {
  const where: any = { status: 'fallback_queued' };
  if (userId) where.userId = userId;

  return prisma.uploadHistory.findMany({
    where,
    include: {
      project: {
        include: {
          videoRender: true,
          thumbnail: true,
          script: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function exportVideoPackage(projectId: string): Promise<string> {
  ensureExportDir();

  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: {
      videoRender: true,
      thumbnail: true,
      script: true,
      uploadHistory: true,
    },
  });
  if (!project) throw new Error(`Project ${projectId} not found`);
  if (!project.videoRender?.videoUrl) throw new Error('No rendered video file');

  const exportDir = path.join(FALLBACK_EXPORT_DIR, projectId);
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const videoSrc = project.videoRender.videoUrl;
  const videoDest = path.join(exportDir, `${project.title || projectId}.mp4`);
  try {
    if (fs.existsSync(videoSrc)) {
      fs.copyFileSync(videoSrc, videoDest);
    }
  } catch (err: any) {
    logger.warn(`[FALLBACK] Could not copy video file: ${err.message}`);
  }

  const metadata = {
    projectId: project.id,
    title: project.title || 'Untitled',
    description: project.description || '',
    topic: project.topic,
    tags: project.uploadHistory?.tags?.split(',').map((t: string) => t.trim()) || [],
    category: project.uploadHistory?.category || '22',
    privacyStatus: project.uploadHistory?.visibility || 'public',
    scriptContent: project.script?.content || '',
    thumbnailUrl: project.thumbnail?.imageUrl || '',
    generatedAt: project.createdAt.toISOString(),
    exportedAt: new Date().toISOString(),
    instructions: [
      '1. Go to https://studio.youtube.com',
      '2. Click "Upload Video" (top right)',
      '3. Select the video file in this folder',
      '4. Copy-paste the title and description from metadata.json',
      '5. Add tags from metadata.json',
      '6. Set privacy status as needed',
      '7. Set as "Made for Kids" appropriately',
      '8. Click "Upload"',
    ],
  };

  const metadataPath = path.join(exportDir, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  const metaRaw = await redisConnection.get(FALLBACK_META_KEY);
  const meta = metaRaw ? JSON.parse(metaRaw) : {};
  meta.exportedCount = (meta.exportedCount || 0) + 1;
  await redisConnection.set(FALLBACK_META_KEY, JSON.stringify(meta));

  await prisma.uploadHistory.update({
    where: { projectId },
    data: { status: 'exported' },
  });

  logger.info(`[FALLBACK] Video package exported for ${projectId}`, {
    path: exportDir,
  });

  return exportDir;
}

export async function retryQueuedUpload(projectId: string): Promise<void> {
  const { default: Bull } = await import('bullmq');
  const { uploadQueue } = await import('../queues/video.queue');

  const history = await prisma.uploadHistory.findUnique({
    where: { projectId },
    include: { project: true },
  });
  if (!history || history.status !== 'fallback_queued') {
    throw new Error(`Project ${projectId} is not in fallback queue`);
  }

  await uploadQueue.add('youtube-upload', {
    projectId,
    channelId: history.channelId || undefined,
    title: history.title || history.project?.title || '',
    description: history.description || history.project?.description || '',
    tags: history.tags ? JSON.parse(history.tags) : [],
    privacyStatus: history.visibility || 'public',
  }, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10000 },
  });

  await prisma.uploadHistory.update({
    where: { projectId },
    data: { status: 'retrying', error: null },
  });

  logger.info(`[FALLBACK] Queued upload retry for project ${projectId}`);
}

export async function retryAllQueuedUploads(): Promise<number> {
  const queued = await prisma.uploadHistory.findMany({
    where: { status: 'fallback_queued' },
  });

  let count = 0;
  for (const item of queued) {
    try {
      await retryQueuedUpload(item.projectId);
      count++;
    } catch (err: any) {
      logger.warn(`[FALLBACK] Failed to retry ${item.projectId}: ${err.message}`);
    }
  }

  logger.info(`[FALLBACK] Retried ${count}/${queued.length} queued uploads`);
  return count;
}

export async function scheduleFallbackRetry(): Promise<void> {
  const active = await isFallbackActive();
  if (!active) return;

  logger.info('[FALLBACK] Running scheduled retry for fallback-queued uploads...');

  try {
    const retried = await retryAllQueuedUploads();
    if (retried > 0 && await isFallbackActive()) {
      const nextRetryMs = getNextRetryDelayMs();
      logger.info(`[FALLBACK] Next retry in ${nextRetryMs / 60000} minutes`);
    }
  } catch (err: any) {
    logger.error('[FALLBACK] Scheduled retry failed', { error: err.message });
  }
}

function getNextRetryDelayMs(): number {
  const retryCount = RETRY_SCHEDULES.length;
  const elapsed = Date.now() - 0;
  for (const schedule of RETRY_SCHEDULES) {
    if (elapsed < schedule.ms) {
      return schedule.ms;
    }
  }
  return RETRY_SCHEDULES[RETRY_SCHEDULES.length - 1].ms;
}

export async function verifyFallbackHealth(): Promise<{
  healthy: boolean;
  active: boolean;
  queuedCount: number;
  issues: string[];
}> {
  const state = await getFallbackState();
  const issues: string[] = [];

  if (state.active) {
    const exportDirExists = fs.existsSync(FALLBACK_EXPORT_DIR);
    if (!exportDirExists) {
      issues.push(`Export directory missing (${FALLBACK_EXPORT_DIR}). Video package export will fail.`);
    }

    if (state.queuedCount > 0) {
      const retrySchedule = RETRY_SCHEDULES.map(s => s.label).join(', ');
      issues.push(`${state.queuedCount} videos queued for upload. Retry schedule: ${retrySchedule}.`);
    }
  } else {
    issues.push('Fallback mode is not active. YouTube OAuth may be functioning normally.');
  }

  return {
    healthy: issues.length === 0 || issues.every(i => !i.startsWith('Export directory missing')),
    active: state.active,
    queuedCount: state.queuedCount,
    issues,
  };
}
