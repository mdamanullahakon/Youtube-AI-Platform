import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { analyticsQueue } from '../queues/video.queue';
import { logger } from '../utils/logger';

export async function getProjectAnalytics(req: Request, res: Response) {
  try {
    const projectId = req.params.projectId as string;

    const job = await analyticsQueue.add('collect-analytics', { projectId });

    res.status(202).json({
      success: true,
      projectId,
      jobId: job.id,
      status: 'queued',
      message: 'Analytics collection queued.',
    });
  } catch (error: any) {
    logger.error('Get analytics failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get analytics' });
  }
}

export async function getDashboardStats(req: Request, res: Response) {
  try {
    const userId = (req as any).userId;

    const [projects, totalViews, uploads] = await Promise.all([
      prisma.videoProject.count({ where: { userId } }),
      prisma.analytics.aggregate({
        _sum: { views: true, likes: true, comments: true, subscribersGained: true },
      }),
      prisma.uploadHistory.count({ where: { userId, status: 'uploaded' } }),
    ]);

    res.json({
      success: true,
      stats: {
        totalProjects: projects,
        totalViews: totalViews._sum.views || 0,
        totalLikes: totalViews._sum.likes || 0,
        totalComments: totalViews._sum.comments || 0,
        subscribersGained: totalViews._sum.subscribersGained || 0,
        totalUploads: uploads,
      },
    });
  } catch (error: any) {
    logger.error('Dashboard stats failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get dashboard stats' });
  }
}

export async function getRecentProjects(req: Request, res: Response) {
  try {
    const userId = (req as any).userId;
    const projects = await prisma.videoProject.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    });

    const enriched = await Promise.all(
      projects.map(async (project) => {
        const [videoRender, analytics, uploadHistory] = await Promise.all([
          prisma.videoRender.findFirst({ where: { projectId: project.id } }),
          prisma.analytics.findFirst({ where: { projectId: project.id } }),
          prisma.uploadHistory.findFirst({ where: { projectId: project.id } }),
        ]);
        return { ...project, videoRender, analytics, uploadHistory };
      })
    );

    res.json({ success: true, projects: enriched });
  } catch (error: any) {
    logger.error('Get recent projects failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get projects' });
  }
}
