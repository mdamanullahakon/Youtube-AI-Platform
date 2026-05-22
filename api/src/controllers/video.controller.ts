import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { enqueueCanonicalPipeline } from '../pipeline/canonical-pipeline.service';
import { logger } from '../utils/logger';

export async function createVideoProject(req: Request, res: Response) {
  try {
    const userId = (req as any).userId;
    const topic = req.body?.topic || 'trending topic';

    const project = await prisma.videoProject.create({
      data: { userId, topic, status: 'draft' },
    });

    let jobId: string | undefined;
    try {
      jobId = await enqueueCanonicalPipeline(project.id, topic, { userId });
      logger.info(`Canonical pipeline job ${jobId} enqueued for project ${project.id}`);
    } catch (queueError: any) {
      logger.warn(`Queue unavailable for project ${project.id}, created as draft: ${queueError.message}`);
    }

    res.status(202).json({
      success: true,
      pipeline: 'canonical-sync',
      project: { id: project.id, topic: project.topic, status: jobId ? 'running' : project.status },
      jobId,
      message: jobId
        ? 'Canonical pipeline queued (sync PipelineOrchestrator). Poll /api/videos/status/:projectId for updates.'
        : 'Project created in draft mode (queue unavailable).',
    });
  } catch (error: any) {
    logger.error('Create project failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to create project' });
  }
}

export async function generateVideoPipeline(req: Request, res: Response) {
  try {
    const projectId = req.params.projectId as string;
    const userId = (req as any).userId;
    const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const jobId = await enqueueCanonicalPipeline(projectId, project.topic, {
      userId: userId || project.userId,
      channelId: project.channelId || undefined,
    });

    logger.info(`Canonical pipeline re-run for project ${projectId}, job: ${jobId}`);

    res.status(202).json({
      success: true,
      pipeline: 'canonical-sync',
      projectId,
      jobId,
      status: 'running',
      message: 'Canonical pipeline queued (Idea → Script → Voice → Video → Upload → Analytics).',
    });
  } catch (error: any) {
    logger.error('Video pipeline enqueue failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Video pipeline failed' });
  }
}

export async function renderVideoHandler(req: Request, res: Response) {
  return res.status(410).json({
    success: false,
    message: 'Standalone render is disabled. Use POST /api/videos/generate/new or POST /api/videos/generate/:projectId for the canonical pipeline.',
    pipeline: 'canonical-sync',
  });
}

export async function deleteProject(req: Request, res: Response) {
  try {
    const projectId = req.params.projectId as string;
    const userId = (req as any).userId;

    const project = await prisma.videoProject.findUnique({ where: { id: projectId }, select: { userId: true } });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
    if (project.userId !== userId) return res.status(403).json({ success: false, message: 'Not authorized' });

    await prisma.$transaction([
      prisma.trendResearch.deleteMany({ where: { projectId } }),
      prisma.script.deleteMany({ where: { projectId } }),
      prisma.thumbnail.deleteMany({ where: { projectId } }),
      prisma.voiceover.deleteMany({ where: { projectId } }),
      prisma.videoRender.deleteMany({ where: { projectId } }),
      prisma.analytics.deleteMany({ where: { projectId } }),
      prisma.uploadHistory.deleteMany({ where: { projectId } }),
      prisma.analyticsLearning.deleteMany({ where: { projectId } }),
      prisma.contentPerformance.deleteMany({ where: { projectId } }),
      prisma.transcriptIntelligence.deleteMany({ where: { projectId } }),
      prisma.thumbnailPerformance.deleteMany({ where: { projectId } }),
      prisma.videoProject.delete({ where: { id: projectId } }),
    ]);

    logger.info(`Project ${projectId} and all related data deleted by user ${userId}`);
    res.json({ success: true, message: 'Project deleted successfully' });
  } catch (error: any) {
    logger.error('Delete project failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to delete project' });
  }
}

export async function getProjectStatus(req: Request, res: Response) {
  try {
    const projectId = req.params.projectId as string;
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        trendResearch: true,
        script: true,
        thumbnail: true,
        voiceover: true,
        videoRender: true,
        analytics: true,
        uploadHistory: true,
      },
    });

    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    res.json({ success: true, project });
  } catch (error: any) {
    logger.error('Get project failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get project' });
  }
}
