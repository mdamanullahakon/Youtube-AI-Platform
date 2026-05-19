import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { GodmodeOrchestrator } from '../services/godmode-orchestrator.service';
import { ChannelLaunchService } from '../services/channel-launch.service';
import { ScriptWriterAgent } from '../agents/script-writer.agent';
import { TrendHunterAgent } from '../agents/trend-hunter.agent';
import { ViralAnalyzerAgent } from '../agents/viral-analyzer.agent';

const orchestrator = new GodmodeOrchestrator();
const launchService = new ChannelLaunchService();
const scriptWriter = new ScriptWriterAgent();
const trendHunter = new TrendHunterAgent();
const viralAnalyzer = new ViralAnalyzerAgent();

export async function initializeGodmode(req: Request, res: Response) {
  try {
    const { niche, language, userId } = req.body;
    const state = await orchestrator.initialize(niche, language, userId);
    res.json({ success: true, data: state });
  } catch (error: any) {
    logger.error('Godmode initialization failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Godmode initialization failed' });
  }
}

export async function scanAndDetectTrends(req: Request, res: Response) {
  try {
    const signals = await trendHunter.scanAllSources();
    res.json({ success: true, data: { signals, count: signals.length } });
  } catch (error: any) {
    logger.error('Trend scan failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Trend scan failed' });
  }
}

export async function analyzeTopics(req: Request, res: Response) {
  try {
    const { topics } = req.body;
    const opportunities = await viralAnalyzer.analyzeAndRank(topics);
    res.json({ success: true, data: opportunities });
  } catch (error: any) {
    logger.error('Topic analysis failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Topic analysis failed' });
  }
}

export async function getNicheRecommendations(req: Request, res: Response) {
  try {
    const refresh = req.query.refresh === 'true';
    if (refresh) {
      await trendHunter.scanAllSources();
    }
    const recommendations = await viralAnalyzer.getTopNicheRecommendations();
    res.json({ success: true, data: recommendations });
  } catch (error: any) {
    logger.error('Niche recommendations failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get niche recommendations' });
  }
}

export async function generateVideoIdeaHandler(req: Request, res: Response) {
  try {
    const { topic, niche, format, saveToDatabase } = req.body;
    const idea = await orchestrator.generateVideoIdea(topic, niche, format);
    if (saveToDatabase) {
      await orchestrator.saveVideoIdea(idea);
    }
    res.json({ success: true, data: idea });
  } catch (error: any) {
    logger.error('Video idea generation failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Video idea generation failed' });
  }
}

export async function generateScriptHandler(req: Request, res: Response) {
  try {
    const { topic, format, niche, emotionalAngle, hookSuggestion } = req.body;
    const script = await scriptWriter.generateViralScript(topic, format, niche, emotionalAngle, hookSuggestion);
    res.json({ success: true, data: script });
  } catch (error: any) {
    logger.error('Script generation failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Script generation failed' });
  }
}

export async function generateRoadmap(req: Request, res: Response) {
  try {
    const { niche, language, format } = req.body;
    const roadmap = await orchestrator.generate30VideoRoadmap(niche, language, format);
    res.json({ success: true, data: roadmap });
  } catch (error: any) {
    logger.error('Roadmap generation failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Roadmap generation failed' });
  }
}

export async function generateLaunchBlueprint(req: Request, res: Response) {
  try {
    const { niche, language, channelName } = req.body;
    const blueprint = await launchService.generateLaunchBlueprint(niche, language, channelName);
    res.json({ success: true, data: blueprint });
  } catch (error: any) {
    logger.error('Launch blueprint generation failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Launch blueprint generation failed' });
  }
}

export async function getFullExecutionPlan(req: Request, res: Response) {
  try {
    const niche = req.params.niche as string;
    const language = (req.query.language as string) || 'english';
    const plan = await orchestrator.getFullExecutionPlan(niche, language as any);
    res.json({ success: true, data: plan });
  } catch (error: any) {
    logger.error('Execution plan failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get execution plan' });
  }
}

export async function generateTitleVariantsHandler(req: Request, res: Response) {
  try {
    const { topic, count } = req.body;
    const titles = await scriptWriter.generateTitleVariants(topic, count);
    res.json({ success: true, data: titles });
  } catch (error: any) {
    logger.error('Title variant generation failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Title variant generation failed' });
  }
}

export async function generateHookVariantsHandler(req: Request, res: Response) {
  try {
    const { topic, count } = req.body;
    const hooks = await scriptWriter.generateHookVariants(topic, count);
    res.json({ success: true, data: hooks });
  } catch (error: any) {
    logger.error('Hook variant generation failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Hook variant generation failed' });
  }
}

export async function getPredictions(req: Request, res: Response) {
  try {
    const niche = req.query.niche as string || 'General';
    const language = (req.query.language as string) || 'english';
    const predictions = await launchService.generatePerformancePredictions(niche, language as any);
    res.json({ success: true, data: predictions });
  } catch (error: any) {
    logger.error('Performance predictions failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get predictions' });
  }
}