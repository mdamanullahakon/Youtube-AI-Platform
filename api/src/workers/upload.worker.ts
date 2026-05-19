import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';
import { uploadToYouTube, YouTubeAuthError } from '../services/youtube.service';
import { prisma } from '../config/db';
import { join } from 'path';
import { AutoCleanupService } from '../services/auto-cleanup.service';
import { FeedbackLoopService } from '../services/feedback-loop.service';
import { activateFallback, queueUploadForFallback, isFallbackActive, deactivateFallback } from '../services/youtube-fallback.service';
import { classifyOAuthError } from '../utils/oauth-error-classifier';

const cleanupService = new AutoCleanupService();
const feedbackLoop = new FeedbackLoopService();

const worker = new Worker(
  'youtube-upload',
  async (job) => {
    logger.info(`Processing upload job ${job.id}`);
    await job.updateProgress(0);

    const { projectId, channelId } = job.data as { projectId: string; channelId?: string };

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: { videoRender: true, thumbnail: true },
    });

    if (!project?.videoRender?.videoUrl) throw new Error('No rendered video found');
    await job.updateProgress(20);

    let videoId: string | null = null;
    const hasYoutubeCredentials = !!(process.env.YOUTUBE_API_KEY || process.env.YOUTUBE_CLIENT_ID);

    if (hasYoutubeCredentials) {
      try {
        videoId = await uploadToYouTube({
          title: project.title || project.topic,
          description: project.description || '',
          tags: [project.topic],
          videoPath: join(process.cwd(), project.videoRender.videoUrl),
          thumbnailPath: project.thumbnail?.imageUrl
            ? join(process.cwd(), project.thumbnail.imageUrl)
            : undefined,
          userId: project.userId,
          channelId: channelId || project.channelId || undefined,
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
    } else {
      videoId = `mock_${Date.now()}`;
      logger.info(`No YouTube credentials found, using mock upload: ${videoId}`);
    }

    if (await isFallbackActive()) {
      const queuedCount = await prisma.uploadHistory.count({ where: { status: 'fallback_queued' } });
      if (queuedCount === 0) {
        await deactivateFallback().catch(() => {});
      }
    }

    await job.updateProgress(70);

    if (videoId) {
      await prisma.uploadHistory.upsert({
        where: { projectId },
        update: { videoId, status: 'uploaded', publishedAt: new Date(), userId: project.userId, channelId: channelId || project.channelId },
        create: { projectId, videoId, status: 'uploaded', publishedAt: new Date(), userId: project.userId, channelId: channelId || project.channelId },
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
    logger.info(`Upload job ${job.id} completed. Video ID: ${videoId}`);
    return { videoId, fallback: false };
  },
  {
    connection: redisConnection,
    concurrency: 1,
    lockDuration: 300_000,
    stalledInterval: 60_000,
  }
);

worker.on('completed', (job) => {
  const result = job.returnvalue;
  if (result?.fallback) {
    logger.warn(`Upload job ${job.id} completed in fallback mode`, {
      projectId: result.projectId,
      errorType: result.fallbackType,
    });
  } else if (result?.videoId) {
    logger.info(`Upload job ${job.id} completed successfully. Video ID: ${result.videoId}`);
  }
});

worker.on('failed', (job, err) => {
  const isAuthError = err instanceof YouTubeAuthError || err.name === 'YouTubeAuthError';
  const level = isAuthError ? 'warn' : 'error';
  logger[level](`Upload job ${job?.id} failed`, {
    error: err.message,
    isAuthError,
  });
});

worker.on('progress', (job, progress) => logger.debug(`Upload job ${job.id} progress: ${progress}%`));
worker.on('error', (err) => {
  if (err.message.includes('SCRIPT') || err.message.includes('evalsha') || err.message.includes('NOSCRIPT')) {
    logger.error('Upload worker FATAL Lua script error — worker shutting down', { error: err.message });
    worker.close();
    return;
  }
  logger.error('Upload worker error', { error: err.message });
});

export { worker };
