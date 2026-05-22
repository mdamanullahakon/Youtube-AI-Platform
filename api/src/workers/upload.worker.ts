import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';
import { uploadToYouTube, YouTubeAuthError } from '../services/youtube.service';
import { quotaManager } from '../services/quota-manager.service';
import { channelLimiter } from '../services/channel-limiter.service';
import { prisma } from '../config/db';
import { join } from 'path';
import { existsSync } from 'fs';
import { AutoCleanupService } from '../services/auto-cleanup.service';
import { FeedbackLoopService } from '../services/feedback-loop.service';
import { activateFallback, queueUploadForFallback, isFallbackActive, deactivateFallback } from '../services/youtube-fallback.service';
import { classifyOAuthError } from '../utils/oauth-error-classifier';
import { OutputValidationGate } from '../services/output-validation.service';
import { PreUploadValidationGate } from '../services/pre-upload-validation.service';
import { parseScriptScenes } from '../utils/helpers';
import { uploadQueue } from '../queues/video.queue';

const cleanupService = new AutoCleanupService();
const feedbackLoop = new FeedbackLoopService();
const validationGate = new OutputValidationGate();
const preUploadGate = new PreUploadValidationGate();
const UPLOAD_QUEUE_NAME = uploadQueue.name;

logger.info(`[UPLOAD_TRACE] Initializing upload worker for queue "${UPLOAD_QUEUE_NAME}"`);

const worker = new Worker(
  UPLOAD_QUEUE_NAME,
  async (job) => {
    logger.info(`[UPLOAD_TRACE] Processing upload job ${job.id}`, {
      queueName: job.queueName,
      jobName: job.name,
      attemptsMade: job.attemptsMade,
      data: {
        projectId: job.data?.projectId,
        channelId: job.data?.channelId,
        pipelineId: job.data?.pipelineId,
      },
    });
    await job.updateProgress(0);

    const { projectId, channelId } = job.data as { projectId: string; channelId?: string };

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: { videoRender: true, thumbnail: true, script: true },
    });

    if (!project?.videoRender?.videoUrl) throw new Error('No rendered video found');
    await job.updateProgress(20);

    let targetChannelId = channelId || project.channelId || undefined;

    if (!targetChannelId) {
      logger.info(`[UPLOAD_TRACE] No channelId in job or project — looking up user's active YouTube account...`);
      const activeAccount = await prisma.youTubeAccount.findFirst({
        where: { userId: project.userId, isConnected: true },
        orderBy: { createdAt: 'asc' },
      });
      if (activeAccount) {
        targetChannelId = activeAccount.channelId;
        logger.info(`[UPLOAD_TRACE] Resolved channelId from user's active YouTube account: ${targetChannelId}`);
      } else {
        logger.warn(`[UPLOAD_TRACE] No connected YouTube account for user ${project.userId}`);
        throw new YouTubeAuthError('No YouTube channel linked to this project. Connect your YouTube channel in Settings first.');
      }
    }

    const videoPath = join(process.cwd(), project.videoRender.videoUrl);
    const fileExists = existsSync(videoPath);
    logger.info(`[UPLOAD_TRACE] Upload worker started — projectId: ${projectId}, userId: ${project.userId}, channelId: ${targetChannelId}, videoPath: ${videoPath}, fileExists: ${fileExists}`);

    if (!fileExists) {
      throw new Error(`[UPLOAD_TRACE] Video file not found at: ${videoPath}`);
    }

    const thumbRel = project.thumbnail?.imageUrl;
    const thumbAbs = thumbRel
      ? (thumbRel.startsWith('/') ? join(process.cwd(), thumbRel.replace(/^\//, '')) : thumbRel)
      : undefined;

    const preUpload = await preUploadGate.validate({
      videoPath,
      thumbnailPath: thumbRel,
      requireThumbnail: true,
    });
    if (!preUpload.passed) {
      throw new Error(`Pre-upload validation failed: ${preUpload.blockers.join(', ')}`);
    }

    const scenes = project.script?.content ? parseScriptScenes(project.script.content) : [];
    const validationResult = await validationGate.validateVideo(videoPath, scenes, undefined, project.title || project.topic);
    if (!validationResult.passed) {
      const blockerNames = validationResult.checks.filter(c => c.severity === 'block' && !c.passed).map(c => c.name);
      logger.error(`[UPLOAD_TRACE] Validation BLOCKED upload for project ${projectId}: ${blockerNames.join(', ')}`);
      logger.warn(`[UPLOAD_TRACE] Suggestion: Re-run the pipeline (auto-regenerate) to fix: ${blockerNames.join(', ')}`);
      throw new Error(`Video validation failed: ${validationResult.summary}`);
    }
    logger.info(`[UPLOAD_TRACE] Validation passed for project ${projectId} — proceeding with upload`);

    let videoId: string | null = null;

    logger.info(`[UPLOAD_TRACE] Upload started — projectId: ${projectId}, channelId: ${targetChannelId}`);

    // Quota pre-check — block if daily quota is low
    const quotaCheck = await quotaManager.preCheck(targetChannelId);
    if (!quotaCheck.canUpload) {
      const waitMs = Math.max(0, quotaCheck.resetAt.getTime() - Date.now());
      logger.warn(`[UPLOAD_TRACE] Quota exhausted for ${targetChannelId}. Re-queueing after ${Math.round(waitMs / 60000)}min`);
      throw new Error(`YouTube quota exhausted for channel ${targetChannelId}. Retry after ${quotaCheck.resetAt.toISOString()}`);
    }

    // Rate limit check — per-channel throttle
    const rateCheck = await channelLimiter.check(targetChannelId);
    if (!rateCheck.allowed) {
      throw new Error(`Channel ${targetChannelId} rate limited. Retry after ${rateCheck.retryAfterSeconds}s`);
    }

    try {
      videoId = await uploadToYouTube({
        title: project.title || project.topic,
        description: project.description || '',
        tags: [project.topic],
        videoPath,
        thumbnailPath: thumbAbs,
        userId: project.userId,
        channelId: targetChannelId,
      });

      logger.info('[UPLOAD_TRACE] uploadToYouTube returned videoId', {
        projectId,
        channelId: targetChannelId,
        videoId,
      });
    } catch (err: any) {
      const fallbackActive = await isFallbackActive();

      if (err instanceof YouTubeAuthError || err.name === 'YouTubeAuthError') {
        if (!fallbackActive) {
          await activateFallback('unknown_oauth', err).catch(e =>
            logger.error('[FALLBACK] Failed to activate fallback', { error: e.message })
          );
        }

        await queueUploadForFallback(projectId, project.userId).catch(e =>
          logger.error('[FALLBACK] Failed to queue upload', { error: e.message })
        );

        const classified = classifyOAuthError(err);
        logger.warn(`[FALLBACK] YouTube upload deferred for ${projectId}`, {
          title: project.title,
          errorType: classified.type,
          fallbackReason: classified.title,
        });

        await job.updateProgress(100);
        return {
          videoId: null,
          fallback: true,
          fallbackType: classified.type,
          projectId,
        };
      }

      throw err;
    }

    if (await isFallbackActive()) {
      const queuedCount = await prisma.uploadHistory.count({ where: { status: 'fallback_queued' } });
      if (queuedCount === 0) {
        try {
          await deactivateFallback();
        } catch (err: any) {
          logger.warn('[FALLBACK] Failed to deactivate fallback after successful upload check', {
            error: err.message,
            projectId,
          });
        }
      }
    }

    await job.updateProgress(70);

    if (videoId) {
      logger.info(`[UPLOAD_TRACE] Upload success — videoId: ${videoId}, projectId: ${projectId}, YouTube URL: https://youtube.com/watch?v=${videoId}`);

      // Record quota and rate limit usage
      await quotaManager.recordUsage(targetChannelId);
      await channelLimiter.recordUpload(targetChannelId);

      await prisma.uploadHistory.upsert({
        where: { projectId },
        update: { videoId, status: 'uploaded', publishedAt: new Date(), userId: project.userId, channelId: targetChannelId },
        create: { projectId, videoId, status: 'uploaded', publishedAt: new Date(), userId: project.userId, channelId: targetChannelId },
      });

      await prisma.videoProject.update({
        where: { id: projectId },
        data: { status: 'published' },
      });

      cleanupService.cleanupAfterUpload(projectId).catch(err =>
        logger.error(`Auto-cleanup failed for ${projectId}`, { error: err.message })
      );

      feedbackLoop.analyzeAfterUpload(projectId).then(analysis => {
        if (analysis) {
          feedbackLoop.updateScriptPromptsBasedOnPerformance(projectId).catch(err =>
            logger.error(`Feedback loop update failed for ${projectId}`, { error: err.message })
          );
        }
      }).catch(err =>
        logger.error(`Feedback loop analysis failed for ${projectId}`, { error: err.message })
      );
    }

    await job.updateProgress(100);
    logger.info(`[UPLOAD_TRACE] Upload job ${job.id} completed. Video ID: ${videoId}`);
    return { videoId, fallback: false };
  },
  {
    connection: redisConnection,
    concurrency: 1,
    lockDuration: 300_000,
    stalledInterval: 60_000,
  }
);

worker.on('ready', async () => {
  const counts = await uploadQueue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed').catch(() => null);
  logger.info(`[UPLOAD_TRACE] Upload worker ready on queue "${UPLOAD_QUEUE_NAME}"`, { counts });
});

worker.on('active', (job) => {
  logger.info(`[UPLOAD_TRACE] Upload job ${job.id} active`, {
    queueName: job.queueName,
    jobName: job.name,
    projectId: job.data?.projectId,
    attemptsMade: job.attemptsMade,
  });
});

worker.on('completed', (job) => {
  const result = job.returnvalue;
  if (result?.fallback) {
    logger.warn(`Upload job ${job.id} completed in fallback mode`, {
      projectId: result.projectId,
      errorType: result.fallbackType,
    });
  } else if (result?.videoId) {
    logger.info(`[UPLOAD_TRACE] Upload job ${job.id} completed successfully. Video ID: ${result.videoId}`);
  }
});

worker.on('failed', (job, err) => {
  const isAuthError = err instanceof YouTubeAuthError || err.name === 'YouTubeAuthError';
  const level = isAuthError ? 'warn' : 'error';
  logger[level](`Upload job ${job?.id} failed`, {
    queueName: job?.queueName,
    jobName: job?.name,
    projectId: job?.data?.projectId,
    attemptsMade: job?.attemptsMade,
    error: err.message,
    isAuthError,
  });
});

worker.on('progress', (job, progress) => logger.debug(`Upload job ${job.id} progress: ${progress}%`));
worker.on('stalled', (jobId) => {
  logger.warn(`[UPLOAD_TRACE] Upload job stalled`, { jobId, queueName: UPLOAD_QUEUE_NAME });
});
worker.on('error', (err) => {
  if (err.message.includes('SCRIPT') || err.message.includes('evalsha') || err.message.includes('NOSCRIPT')) {
    logger.error('Upload worker FATAL Lua script error — worker shutting down', { error: err.message });
    worker.close();
    return;
  }
  logger.error('Upload worker error', { error: err.message });
});

export { worker };
