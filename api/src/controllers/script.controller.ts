import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { enqueueCanonicalPipeline } from '../pipeline/canonical-pipeline.service';
import { aiLogger as logger } from '../utils/logger';

export async function generateScriptHandler(req: Request, res: Response) {
  try {
    const projectId = req.params.projectId as string;
    const userId = (req as any).userId;
    const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ success: false, message: 'Project not found' });

    const jobId = await enqueueCanonicalPipeline(projectId, project.topic, {
      userId: userId || project.userId,
      channelId: project.channelId || undefined,
    });

    logger.info(`Canonical pipeline job ${jobId} enqueued for project ${projectId}`);

    res.status(202).json({
      success: true,
      pipeline: 'canonical-sync',
      projectId,
      jobId,
      status: 'running',
      message: 'Canonical pipeline queued. Poll /api/videos/status/:projectId for updates.',
    });
  } catch (error: any) {
    logger.error('Script generation enqueue failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Script generation failed' });
  }
}
