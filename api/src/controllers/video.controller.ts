import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { videoQueue, renderQueue } from '../queues/video.queue';
import { createFullPipelineFlow, createScriptToRenderFlow } from '../queues/pipeline.queue';
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
      const job = await videoQueue.add('full-pipeline', { projectId: project.id, topic });
      jobId = job.id;
      logger.info(`Full pipeline job ${job.id} enqueued for project ${project.id}`);
    } catch (queueError: any) {
      logger.warn(`Queue unavailable for project ${project.id}, created as draft: ${queueError.message}`);
    }

    res.status(202).json({
      success: true,
      project: { id: project.id, topic: project.topic, status: project.status },
      jobId,
      message: jobId
        ? 'Pipeline job queued. Poll /api/videos/status/:projectId for updates.'
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
    const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const existingScript = await prisma.script.findFirst({ where: { projectId } });
    if (!existingScript) return res.status(400).json({ success: false, message: 'No script found. Generate a script first.' });

    await prisma.videoProject.update({
      where: { id: projectId },
      data: { status: 'processing' },
    });

    const flow = await createScriptToRenderFlow(projectId);

    logger.info(`Post-script pipeline flow created for project ${projectId}, root job: ${flow.pipelineJobId}`);

    res.status(202).json({
      success: true,
      projectId,
      pipelineJobId: flow.pipelineJobId,
      status: 'processing',
      message: 'Pipeline flow created (render → upload → analytics). Agents dispatched after script generation.',
    });
  } catch (error: any) {
    logger.error('Video pipeline enqueue failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Video pipeline failed' });
  }
}

export async function renderVideoHandler(req: Request, res: Response) {
  try {
    const projectId = req.params.projectId as string;
    const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    await prisma.videoRender.upsert({
      where: { projectId },
      update: { status: 'pending', progress: 0 },
      create: { projectId, status: 'pending', progress: 0 },
    });

    const job = await renderQueue.add('render-video', { projectId });

    logger.info(`Render job ${job.id} enqueued for project ${projectId}`);

    res.status(202).json({
      success: true,
      projectId,
      jobId: job.id,
      status: 'queued',
      message: 'Render job queued. Poll /api/videos/status/:projectId for updates.',
    });
  } catch (error: any) {
    logger.error('Render enqueue failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Render failed' });
  }
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
