import { Request, Response } from 'express';
import { AnalyticsLearningService } from '../services/analytics-learning.service';
import { CTRAnalyzer } from '../services/ctr-analyzer.service';
import { RetentionAnalyzer } from '../services/retention-analyzer.service';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { paginate, buildPaginatedResponse } from '../validators/common.validator';

const learningService = new AnalyticsLearningService();
const ctrAnalyzer = new CTRAnalyzer();
const retentionAnalyzer = new RetentionAnalyzer();

export async function analyzeProjectLearning(req: Request, res: Response) {
  try {
    const projectId = req.params.projectId as string;
    const enhanceWithAI = req.body.enhanceWithAI !== false;

    const result = await learningService.analyzeProject({ projectId, enhanceWithAI });

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('Analytics learning analysis failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Analytics learning analysis failed' });
  }
}

export async function getLearningCorrelations(req: Request, res: Response) {
  try {
    const correlations = await retentionAnalyzer.analyzeAllCorrelations();
    res.json({ success: true, data: correlations });
  } catch (error: any) {
    logger.error('Failed to get correlations', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get correlations' });
  }
}

export async function getThumbnailAnalysis(req: Request, res: Response) {
  try {
    const analysis = await ctrAnalyzer.analyzeAllThumbnails();
    res.json({ success: true, data: analysis });
  } catch (error: any) {
    logger.error('Failed to get thumbnail analysis', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get thumbnail analysis' });
  }
}

export async function getProjectThumbnailAnalysis(req: Request, res: Response) {
  try {
    const analysis = await ctrAnalyzer.analyzeProjectThumbnail(req.params.projectId as string);
    res.json({ success: true, data: analysis });
  } catch (error: any) {
    logger.error('Failed to get project thumbnail analysis', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get thumbnail analysis' });
  }
}

export async function getRetentionAnalysis(req: Request, res: Response) {
  try {
    const projectId = req.params.projectId as string;
    const [correlation, dropOffs, curve] = await Promise.all([
      retentionAnalyzer.correlateHooksWithRetention(projectId),
      retentionAnalyzer.analyzeDropOffPoints(projectId),
      retentionAnalyzer.generateRetentionCurve(projectId),
    ]);

    res.json({
      success: true,
      data: { correlation, dropOffs, curve },
    });
  } catch (error: any) {
    logger.error('Failed to get retention analysis', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get retention analysis' });
  }
}

export async function getProjectLearning(req: Request, res: Response) {
  try {
    const learning = await prisma.analyticsLearning.findUnique({
      where: { projectId: req.params.projectId as string },
    });

    if (!learning) {
      return res.status(404).json({ success: false, message: 'No learning data for this project' });
    }

    res.json({ success: true, data: learning });
  } catch (error: any) {
    logger.error('Failed to get learning data', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get learning data' });
  }
}

export async function getGlobalReport(req: Request, res: Response) {
  try {
    const report = await learningService.getGlobalReport();
    res.json({ success: true, data: report });
  } catch (error: any) {
    logger.error('Failed to get global report', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get global report' });
  }
}

export async function getCrossProjectStats(req: Request, res: Response) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { skip, take } = paginate({ page, limit });
    const stats = await learningService.correlateAcrossProjects(skip, take);
    res.json({ success: true, data: stats });
  } catch (error: any) {
    logger.error('Failed to get cross-project stats', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get cross-project stats' });
  }
}

export async function getPerformanceRecords(req: Request, res: Response) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const { skip, take } = paginate({ page, limit });

    const [records, total] = await Promise.all([
      prisma.contentPerformance.findMany({
        orderBy: { actualViews: 'desc' },
        skip,
        take,
      }),
      prisma.contentPerformance.count(),
    ]);

    res.json(buildPaginatedResponse(records, total, { page, limit }));
  } catch (error: any) {
    logger.error('Failed to get performance records', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get performance records' });
  }
}

export async function getScriptFeedback(req: Request, res: Response) {
  try {
    const topic = req.query.topic as string | undefined;
    const format = (req.query.format as string) || 'Shorts';
    const feedback = await learningService.getScriptFeedback(topic, format);
    res.json({ success: true, data: feedback });
  } catch (error: any) {
    logger.error('Failed to get script feedback', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get script feedback' });
  }
}

export async function predictThumbnailCTR(req: Request, res: Response) {
  try {
    const { style, topic } = req.body;
    if (!style || !topic) {
      return res.status(400).json({ success: false, message: 'style and topic are required' });
    }
    const predictedCTR = await ctrAnalyzer.predictThumbnailCTR(style, topic);
    res.json({ success: true, data: { style, topic, predictedCTR } });
  } catch (error: any) {
    logger.error('Failed to predict thumbnail CTR', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to predict thumbnail CTR' });
  }
}

export async function saveThumbnailPerformance(req: Request, res: Response) {
  try {
    const { projectId, style, prompt, predictedCTR } = req.body;
    if (!projectId || !style) {
      return res.status(400).json({ success: false, message: 'projectId and style are required' });
    }
    await ctrAnalyzer.saveThumbnailPerformance(projectId, style, prompt, predictedCTR || 0);
    res.json({ success: true, message: 'Thumbnail performance saved' });
  } catch (error: any) {
    logger.error('Failed to save thumbnail performance', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to save thumbnail performance' });
  }
}
