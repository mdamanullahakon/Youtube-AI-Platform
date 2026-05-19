import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { scriptQueue } from '../queues/video.queue';
import { aiLogger as logger } from '../utils/logger';

export async function generateScriptHandler(req: Request, res: Response) {
  try {
    const projectId = req.params.projectId as string;
    const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const job = await scriptQueue.add('script-generation', {
      projectId,
      topic: project.topic,
      format: project.format || 'Shorts',
    });

    logger.info(`Script job ${job.id} enqueued for project ${projectId}`);

    res.status(202).json({
      success: true,
      projectId,
      jobId: job.id,
      status: 'queued',
      message: 'Script generation queued. Poll /api/videos/status/:projectId for updates.',
    });
  } catch (error: any) {
    logger.error('Script generation enqueue failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Script generation failed' });
  }
}
