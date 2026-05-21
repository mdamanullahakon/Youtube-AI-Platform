import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { uploadQueue } from '../queues/video.queue';
import { logger } from '../utils/logger';
import { paginate, buildPaginatedResponse } from '../validators/common.validator';
import {
  getQueuedUploads,
  exportVideoPackage,
  retryQueuedUpload,
  retryAllQueuedUploads,
  getFallbackState,
  verifyFallbackHealth,
  isFallbackActive,
} from '../services/youtube-fallback.service';

export async function uploadToYouTubeHandler(req: Request, res: Response) {
  try {
    const projectId = req.params.projectId as string;
    const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const videoRender = await prisma.videoRender.findFirst({ where: { projectId } });
    if (!videoRender?.videoUrl) return res.status(400).json({ success: false, message: 'Video not rendered yet' });

    const fallbackActive = await isFallbackActive();
    if (fallbackActive) {
      return res.status(202).json({
        success: true,
        projectId,
        status: 'fallback_queued',
        message: 'YouTube is in fallback mode. Video will be queued for upload once YouTube reconnects.',
        fallback: true,
      });
    }

    const job = await uploadQueue.add('upload-video', {
      projectId,
      title: project.title || project.topic,
      description: project.description || '',
      tags: [project.topic],
      privacyStatus: 'public',
    });

    await prisma.videoProject.update({
      where: { id: projectId },
      data: { status: 'uploading' },
    });

    logger.info(`Upload job ${job.id} enqueued for project ${projectId}`);

    res.status(202).json({
      success: true,
      projectId,
      jobId: job.id,
      status: 'processing',
      message: 'Upload job accepted. Poll /api/videos/status/:projectId for updates.',
    });
  } catch (error: any) {
    logger.error('Upload enqueue failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
}

export async function getUploadHistory(req: Request, res: Response) {
  try {
    const userId = (req as any).userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { skip, take } = paginate({ page, limit });

    const [history, total] = await Promise.all([
      prisma.uploadHistory.findMany({
        where: { userId },
        include: {
          project: {
            include: { videoRender: true, analytics: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.uploadHistory.count({ where: { userId } }),
    ]);

    res.json(buildPaginatedResponse(history, total, { page, limit }));
  } catch (error: any) {
    logger.error('Get upload history failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to fetch upload history' });
  }
}

export async function getFallbackStatusHandler(_req: Request, res: Response) {
  try {
    const state = await getFallbackState();
    res.json({ success: true, data: state });
  } catch (error: any) {
    logger.error('Get fallback status failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get fallback status' });
  }
}

export async function listFallbackQueueHandler(req: Request, res: Response) {
  try {
    const userId = (req as any).userId;
    const queued = await getQueuedUploads(userId);
    res.json({ success: true, data: queued });
  } catch (error: any) {
    logger.error('List fallback queue failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to list fallback queue' });
  }
}

export async function exportVideoHandler(req: Request, res: Response) {
  try {
    const projectId = req.params.projectId as string;
    const exportPath = await exportVideoPackage(projectId);
    res.json({
      success: true,
      message: 'Video package exported for manual upload',
      exportPath,
      instructions: [
        '1. Navigate to the export folder',
        '2. Upload the MP4 file to YouTube Studio',
        '3. Use metadata.json for title, description, and tags',
      ],
    });
  } catch (error: any) {
    logger.error('Export video failed', { error: error.message });
    res.status(500).json({ success: false, message: error.message || 'Export failed' });
  }
}

export async function retryFallbackHandler(req: Request, res: Response) {
  try {
    const projectId = req.params.projectId as string;
    await retryQueuedUpload(projectId);
    res.json({ success: true, message: 'Upload retry initiated' });
  } catch (error: any) {
    logger.error('Retry fallback upload failed', { error: error.message });
    res.status(500).json({ success: false, message: error.message || 'Retry failed' });
  }
}

export async function retryAllFallbackHandler(_req: Request, res: Response) {
  try {
    const count = await retryAllQueuedUploads();
    res.json({ success: true, message: `Retried ${count} queued uploads` });
  } catch (error: any) {
    logger.error('Retry all fallback uploads failed', { error: error.message });
    res.status(500).json({ success: false, message: error.message || 'Retry failed' });
  }
}

export async function fallbackHealthHandler(_req: Request, res: Response) {
  try {
    const health = await verifyFallbackHealth();
    res.json({ success: true, data: health });
  } catch (error: any) {
    logger.error('Fallback health check failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Health check failed' });
  }
}
