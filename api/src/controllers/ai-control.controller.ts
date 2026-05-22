import { Request, Response, NextFunction } from 'express';
import { ErrorFixerService } from '../services/error-fixer.service';
import { prisma } from '../config/db';
import { redisConnection } from '../config/redis';
import { MonitoringService } from '../services/monitoring.service';
import { ALL_QUEUES, queueMap } from '../queues/video.queue';

export async function getSystemStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const health = await MonitoringService.getHealth();

    const queueMetrics = [];
    for (const { name } of ALL_QUEUES) {
      try {
        const queue = queueMap[name];
        if (!queue) continue;
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
          queue.getDelayedCount(),
        ]);
        queueMetrics.push({ name, waiting, active, completed, failed, delayed });
      } catch {}
    }

    const errorSummary = ErrorFixerService.getFixSummary();
    const recentErrors = ErrorFixerService.getErrorHistory(10);

    res.json({
      success: true,
      health,
      queues: queueMetrics,
      errors: { summary: errorSummary, recent: recentErrors },
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    next(err);
  }
}

export async function startAutomation(req: Request, res: Response, next: NextFunction) {
  try {
    await redisConnection.set('automation:active', 'true');
    res.json({ success: true, message: 'Automation started' });
  } catch (err: any) {
    next(err);
  }
}

export async function stopAutomation(req: Request, res: Response, next: NextFunction) {
  try {
    await redisConnection.set('automation:active', 'false');
    res.json({ success: true, message: 'Automation stopped' });
  } catch (err: any) {
    next(err);
  }
}

export async function getAutomationStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const active = await redisConnection.get('automation:active');
    res.json({ success: true, active: active === 'true' });
  } catch (err: any) {
    next(err);
  }
}

export async function getErrors(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const errors = ErrorFixerService.getErrorHistory(limit);
    const summary = ErrorFixerService.getFixSummary();
    res.json({ success: true, errors, summary });
  } catch (err: any) {
    next(err);
  }
}

export async function fixError(req: Request, res: Response, next: NextFunction) {
  try {
    const errorId = req.params.errorId as string;
    const result = await ErrorFixerService.manualFix(errorId);
    if (!result) {
      return res.status(404).json({ success: false, message: 'Error not found' });
    }
    res.json({ success: true, fix: result });
  } catch (err: any) {
    next(err);
  }
}

export async function fixAllErrors(req: Request, res: Response, next: NextFunction) {
  try {
    const results = await ErrorFixerService.fixAllOpen();
    res.json({ success: true, fixes: results, count: results.length });
  } catch (err: any) {
    next(err);
  }
}

export async function getViralOpportunities(req: Request, res: Response, next: NextFunction) {
  try {
    const opportunities = await prisma.viralOpportunity.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json({ success: true, opportunities });
  } catch (err: any) {
    next(err);
  }
}

export async function getWinningPatterns(req: Request, res: Response, next: NextFunction) {
  try {
    const patterns = await prisma.winningPattern.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json({ success: true, patterns });
  } catch (err: any) {
    next(err);
  }
}

export async function getChannelMetrics(req: Request, res: Response, next: NextFunction) {
  try {
    const channels = await prisma.channelMetrics.findMany({
      orderBy: { collectedAt: 'desc' },
      take: 10,
    });
    res.json({ success: true, channels });
  } catch (err: any) {
    next(err);
  }
}

export async function generateVideoNow(req: Request, res: Response, next: NextFunction) {
  try {
    const { topic } = req.body;
    if (!topic) return res.status(400).json({ success: false, message: 'Topic required' });

    const project = await prisma.videoProject.create({
      data: {
        topic,
        status: 'queued',
        userId: (req as any).user?.id || 'system',
      },
    });

    const { enqueueCanonicalPipeline } = require('../pipeline/canonical-pipeline.service');
    const jobId = await enqueueCanonicalPipeline(project.id, topic, {
      userId: (req as any).user?.id || project.userId,
    });

    res.json({
      success: true,
      pipeline: 'canonical-sync',
      message: 'Canonical pipeline queued',
      projectId: project.id,
      jobId,
    });
  } catch (err: any) {
    next(err);
  }
}

export async function regenerateScript(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = req.params;
    if (!projectId) return res.status(400).json({ success: false, message: 'Project ID required' });

    const project = await prisma.videoProject.findUnique({ where: { id: projectId as string } });
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const { enqueueCanonicalPipeline } = require('../pipeline/canonical-pipeline.service');
    const jobId = await enqueueCanonicalPipeline(project.id, project.topic, { userId: project.userId });

    res.json({
      success: true,
      pipeline: 'canonical-sync',
      message: 'Canonical pipeline re-queued',
      jobId,
    });
  } catch (err: any) {
    next(err);
  }
}
