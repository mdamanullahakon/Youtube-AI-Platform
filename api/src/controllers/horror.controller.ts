import { Request, Response } from 'express';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { HorrorScriptAgent } from '../agents/horror-script.agent';
import { generateHorrorSEO } from '../agents/horror-seo.agent';
import { scriptQueue, agentQueue, renderQueue, uploadQueue } from '../queues/video.queue';
import { StrategyEngine } from '../services/strategy-engine.service';
import { HorrorPipelineService } from '../pipeline/horror-pipeline.service';

const horrorAgent = new HorrorScriptAgent();
const strategyEngine = new StrategyEngine();
const horrorPipeline = new HorrorPipelineService();

export async function generateHorrorStoryHandler(req: Request, res: Response) {
  try {
    const { topic, subNiche, format, emotionalAngle, saveToDatabase } = req.body;

    if (!topic) {
      return res.status(400).json({ success: false, message: 'Topic is required' });
    }

    const story = await horrorAgent.generateHorrorStory(topic, subNiche, format, emotionalAngle);

    if (saveToDatabase) {
      const project = await prisma.videoProject.create({
        data: {
          userId: req.body.userId || 'system',
          topic,
          title: story.viralTitle,
          format: format || 'Shorts',
          status: 'script_generated',
        },
      });

      await prisma.script.create({
        data: {
          projectId: project.id,
          content: story.fullScript,
          targetLength: format || 'long-form',
          wordCount: story.wordCount,
          hook: story.openingHook,
        },
      });

      return res.status(201).json({
        success: true,
        data: story,
        projectId: project.id,
      });
    }

    res.json({ success: true, data: story });
  } catch (error: any) {
    logger.error('Horror story generation failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Horror story generation failed' });
  }
}

export async function generateHorrorStoryAndEnqueueHandler(req: Request, res: Response) {
  try {
    const { topic, subNiche, format, emotionalAngle, channelId, autoUpload } = req.body;

    if (!topic) {
      return res.status(400).json({ success: false, message: 'Topic is required' });
    }

    const userId = req.body.userId || (req as any).user?.id || 'system';

    const project = await prisma.videoProject.create({
      data: {
        userId,
        topic,
        title: topic,
        format: format || 'long-form',
        status: 'draft',
      },
    });

    logger.info(`[HorrorPipeline] Starting full pipeline for project ${project.id}: "${topic}"`);

    const result = await horrorPipeline.runHorrorPipeline({
      projectId: project.id,
      userId,
      topic,
      channelId,
      autoUpload: autoUpload !== false,
      horrorType: (subNiche as any) || 'psychological',
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        projectId: project.id,
        errors: result.errors,
        message: 'Horror pipeline failed — see errors for details',
      });
    }

    logger.info(`Horror pipeline complete for ${project.id}: video=${result.videoUrl ? 'rendered' : 'failed'}, upload=${result.uploadVideoId || 'pending'}`);

    res.status(201).json({
      success: true,
      projectId: project.id,
      data: {
        script: {
          wordCount: result.script?.split(/\s+/).length || 0,
          sceneCount: result.sceneCount || 0,
        },
        voiceover: result.voiceoverUrl ? 'generated' : 'fallback-used',
        video: result.videoUrl ? 'rendered' : 'pending',
        thumbnail: result.thumbnailUrl || 'pending',
        upload: result.uploadVideoId ? {
          videoId: result.uploadVideoId,
          status: 'uploaded',
        } : 'pending',
        channel: result.channelAssignment || 'unassigned',
        analytics: 'tracking-enabled',
      },
      message: 'Horror pipeline complete — video rendered and uploaded',
    });
  } catch (error: any) {
    logger.error('Horror story pipeline failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Horror story pipeline failed' });
  }
}

export async function generateHorrorSEOHandler(req: Request, res: Response) {
  try {
    const { storyTitle, topic, niche, hook } = req.body;

    if (!storyTitle || !topic) {
      return res.status(400).json({ success: false, message: 'storyTitle and topic are required' });
    }

    const seo = await generateHorrorSEO(storyTitle, topic, niche, hook);
    res.json({ success: true, data: seo });
  } catch (error: any) {
    logger.error('Horror SEO generation failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Horror SEO generation failed' });
  }
}

export async function generateHorrorTitleVariantsHandler(req: Request, res: Response) {
  try {
    const { topic, count } = req.body;

    if (!topic) {
      return res.status(400).json({ success: false, message: 'Topic is required' });
    }

    const titles = await horrorAgent.generateTitleVariants(topic, count);
    res.json({ success: true, data: titles });
  } catch (error: any) {
    logger.error('Horror title variant generation failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Title variant generation failed' });
  }
}

export async function generateHorrorHookVariantsHandler(req: Request, res: Response) {
  try {
    const { topic, count } = req.body;

    if (!topic) {
      return res.status(400).json({ success: false, message: 'Topic is required' });
    }

    const hooks = await horrorAgent.generateHookVariants(topic, count);
    res.json({ success: true, data: hooks });
  } catch (error: any) {
    logger.error('Horror hook variant generation failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Hook variant generation failed' });
  }
}

export async function getHorrorNicheStrategyHandler(req: Request, res: Response) {
  try {
    const niche = (req.params.niche as string) || 'Horror';
    const strategy = await strategyEngine.getOrCreateStrategy(niche);
    res.json({ success: true, data: strategy });
  } catch (error: any) {
    logger.error('Horror niche strategy fetch failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get niche strategy' });
  }
}

export async function listHorrorSubNichesHandler(_req: Request, res: Response) {
  const subNiches = [
    { id: 'paranormal', label: 'Paranormal Horror', description: 'Ghosts, spirits, haunted locations' },
    { id: 'psychological', label: 'Psychological Horror', description: 'Mind games, perception, sanity' },
    { id: 'analog-horror', label: 'Analog Horror', description: 'VHS tapes, broadcasts, archived footage' },
    { id: 'missing-persons', label: 'Missing Persons', description: 'Disappearances, cold cases, 411' },
    { id: 'emergency-recordings', label: 'Emergency Recordings', description: '911 calls, radio distress, black box' },
    { id: 'rural-isolation', label: 'Rural Isolation', description: 'Remote cabins, farm horror, woods' },
    { id: 'abandoned-places', label: 'Abandoned Places', description: 'Asylums, hospitals, ghost towns' },
    { id: 'ritual-horror', label: 'Ritual Horror', description: 'Cults, ceremonies, forbidden practices' },
    { id: 'family-secrets', label: 'Family Secrets', description: 'Generational trauma, hidden past' },
    { id: 'forest-horror', label: 'Forest Horror', description: 'Woods, camping, hiking gone wrong' },
    { id: 'possession', label: 'Possession', description: 'Demonic, entity control, exorcism' },
    { id: 'unknown-entities', label: 'Unknown Entities', description: 'Cryptids, skinwalkers, mimics' },
    { id: 'time-loop-horror', label: 'Time Loop Horror', description: 'Trapped in time, repeating nightmare' },
    { id: 'dark-water', label: 'Dark Water Horror', description: 'Lakes, oceans, underwater dread' },
    { id: 'mimic-entities', label: 'Mimic Entities', description: 'Things that pretend to be human' },
    { id: 'surveillance-horror', label: 'Surveillance Horror', description: 'Watched, recorded, monitored' },
    { id: 'sleep-experiments', label: 'Sleep Experiments', description: 'Sleep paralysis, dream invasion' },
    { id: 'vhs-tape', label: 'VHS Tape Horror', description: 'Found footage, cursed recordings' },
  ];

  res.json({ success: true, data: subNiches });
}

export async function previewHorrorSceneImagesHandler(req: Request, res: Response) {
  try {
    const { scenes } = req.body;

    if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
      return res.status(400).json({ success: false, message: 'Scenes array is required' });
    }

    const enhanced = await horrorAgent.generateVisualSequence(scenes);

    const prompts = enhanced.map(s => ({
      sceneIndex: s.index,
      text: s.text,
      prompt: s.visualPrompt,
      cameraAngle: s.cameraAngle,
      lighting: s.lighting,
      atmosphere: s.atmosphere,
    }));

    res.json({ success: true, data: prompts });
  } catch (error: any) {
    logger.error('Horror scene preview failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Scene preview generation failed' });
  }
}
