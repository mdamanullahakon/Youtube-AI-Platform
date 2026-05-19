import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { trendQueue } from '../queues/video.queue';
import { logger } from '../utils/logger';
import { paginate, buildPaginatedResponse } from '../validators/common.validator';

export async function analyzeTrends(req: Request, res: Response) {
  try {
    const userId = (req as any).userId || 'anonymous';

    const project = await prisma.videoProject.create({
      data: { userId, topic: 'trending', status: 'draft' },
    });

    const job = await trendQueue.add('trend-analysis', { projectId: project.id });

    logger.info(`Trend job ${job.id} enqueued for project ${project.id}`);

    res.status(202).json({
      success: true,
      projectId: project.id,
      jobId: job.id,
      status: 'queued',
      message: 'Trend analysis queued. Poll /api/videos/status/:projectId for updates.',
    });
  } catch (error: any) {
    logger.error('Trend analysis enqueue failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Trend analysis failed' });
  }
}

export async function getTrendHistory(req: Request, res: Response) {
  try {
    const userId = (req as any).userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { skip, take } = paginate({ page, limit });

    const [projects, total] = await Promise.all([
      prisma.videoProject.findMany({
        where: { userId },
        include: { trendResearch: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.videoProject.count({ where: { userId } }),
    ]);

    res.json(buildPaginatedResponse(projects, total, { page, limit }));
  } catch (error: any) {
    logger.error('Get trend history failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to fetch trends' });
  }
}
