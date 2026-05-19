import { Request, Response } from 'express';
import { transcriptQueue } from '../queues/video.queue';
import { TranscriptIntelligenceService } from '../services/transcript-intelligence.service';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';

const intelligenceService = new TranscriptIntelligenceService();

export async function analyzeTranscriptIntelligence(req: Request, res: Response) {
  try {
    const { videoIds, projectId, enhanceWithAI } = req.body;
    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return res.status(400).json({ success: false, message: 'videoIds array is required' });
    }

    const job = await transcriptQueue.add('transcript-analysis', {
      videoIds,
      projectId: projectId || '',
      enhanceWithAI: enhanceWithAI !== false,
      userId: (req as any).user?.id,
    });

    logger.info(`Transcript intelligence job ${job.id} enqueued for ${videoIds.length} videos`);
    res.status(202).json({
      success: true,
      jobId: job.id,
      status: 'queued',
      message: 'Transcript intelligence analysis queued.',
    });
  } catch (error: any) {
    logger.error('Transcript intelligence enqueue failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Transcript intelligence failed' });
  }
}

export async function analyzeTranscriptText(req: Request, res: Response) {
  try {
    const { transcriptText, sourceVideoIds, projectId, enhanceWithAI } = req.body;
    if (!transcriptText || typeof transcriptText !== 'string' || transcriptText.length < 10) {
      return res.status(400).json({ success: false, message: 'transcriptText is required (min 10 chars)' });
    }

    const result = await intelligenceService.analyze({
      transcript: transcriptText,
      sourceVideoIds: sourceVideoIds || [],
      projectId: projectId || '',
      enhanceWithAI: enhanceWithAI !== false,
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    logger.error('Transcript text analysis failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Transcript analysis failed' });
  }
}

export async function getInsights(req: Request, res: Response) {
  try {
    const category = req.query.category as string | undefined;
    const limit = parseInt(req.query.limit as string) || 20;
    const validCategories = ['hook', 'structure', 'pacing', 'cta', 'emotional', 'retention', 'storytelling', 'general'];
    const cat = Array.isArray(category) ? category[0] : category;
    const insights = await intelligenceService['learningEngine'].getTopInsights(
      (cat && validCategories.includes(cat)) ? cat as any : undefined,
      Math.min(50, limit),
    );

    res.json({ success: true, data: insights });
  } catch (error: any) {
    logger.error('Failed to fetch insights', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to fetch insights' });
  }
}

export async function applyInsight(req: Request, res: Response) {
  try {
    await intelligenceService['learningEngine'].recordApplication(req.params.id as string);
    res.json({ success: true, message: 'Application recorded' });
  } catch (error: any) {
    logger.error('Failed to record insight application', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to record application' });
  }
}

export async function getScriptImprovements(req: Request, res: Response) {
  try {
    const topic = req.query.topic as string;
    const format = (req.query.format as string) || 'Shorts';

    if (!topic) {
      return res.status(400).json({ success: false, message: 'topic query parameter is required' });
    }

    const improvements = await intelligenceService.getScriptImprovements(topic, format);
    res.json({ success: true, data: improvements });
  } catch (error: any) {
    logger.error('Failed to get script improvements', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get script improvements' });
  }
}

export async function getProjectTranscriptIntelligence(req: Request, res: Response) {
  try {
    const intelligence = await prisma.transcriptIntelligence.findUnique({
      where: { projectId: req.params.projectId as string },
    });

    if (!intelligence) {
      return res.status(404).json({ success: false, message: 'No transcript intelligence found for this project' });
    }

    res.json({ success: true, data: intelligence });
  } catch (error: any) {
    logger.error('Failed to fetch project transcript intelligence', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to fetch transcript intelligence' });
  }
}

export async function getPerformanceCorrelation(req: Request, res: Response) {
  try {
    const insights = await intelligenceService['learningEngine'].correlatePerformanceWithScripts();
    res.json({ success: true, data: insights });
  } catch (error: any) {
    logger.error('Failed to correlate performance', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to correlate performance' });
  }
}
