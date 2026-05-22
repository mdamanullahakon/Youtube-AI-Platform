import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { enqueueCanonicalPipeline } from '../pipeline/canonical-pipeline.service';
import { logger } from '../utils/logger';

export async function runAutoPipelineHandler(req: Request, res: Response) {
  const userId = (req as any).userId;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  logger.info('[AUTO_PIPELINE] Manual trigger — routing to canonical sync pipeline for user ' + userId);

  const account = await prisma.youTubeAccount.findFirst({
    where: { userId, isConnected: true },
    orderBy: { createdAt: 'asc' },
  });

  const project = await prisma.videoProject.create({
    data: {
      userId,
      channelId: account?.channelId,
      topic: 'Automated daily content',
      status: 'draft',
    },
  });

  try {
    const jobId = await enqueueCanonicalPipeline(project.id, project.topic, {
      userId,
      channelId: account?.channelId,
    });

    return res.status(202).json({
      success: true,
      pipeline: 'canonical-sync',
      message: 'Canonical pipeline queued',
      data: { projectId: project.id, jobId },
    });
  } catch (err: any) {
    logger.error('[AUTO_PIPELINE] Failed to enqueue canonical pipeline', { error: err.message });
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to start canonical pipeline',
    });
  }
}
