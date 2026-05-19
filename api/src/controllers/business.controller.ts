import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import { ViralIntelligenceService } from '../services/viral-intelligence.service';
import { WinningPatternsService } from '../services/winning-patterns.service';
import { RetentionOptimizer } from '../services/retention-optimizer.service';
import { ThumbnailOptimizer } from '../services/thumbnail-optimizer.service';
import { TitleOptimizer } from '../services/title-optimizer.service';
import { MonetizationService } from '../services/monetization.service';
import { FeedbackLoopService } from '../services/feedback-loop.service';
import { StrategyEngine } from '../services/strategy-engine.service';
import { UploadSchedulerService } from '../services/upload-scheduler.service';
import { AutoCleanupService } from '../services/auto-cleanup.service';
import { CTRPredictor } from '../services/ctr-predictor.service';
import { RetentionSimulator } from '../services/retention-simulator.service';
import { MonetizationPredictor } from '../services/monetization-predictor.service';
import { ABTestingService } from '../services/ab-testing.service';
import { UploadTimeOptimizer } from '../services/upload-time-optimizer.service';
import { ContentQualityService } from '../services/content-quality.service';

const viralService = new ViralIntelligenceService();
const patternsService = new WinningPatternsService();
const retOptimizer = new RetentionOptimizer();
const thumbOptimizer = new ThumbnailOptimizer();
const tOptimizer = new TitleOptimizer();
const monService = new MonetizationService();
const feedbackService = new FeedbackLoopService();
const stratEngine = new StrategyEngine();
const scheduler = new UploadSchedulerService();
const cleanupService = new AutoCleanupService();
const ctrPredictor = new CTRPredictor();
const retentionSim = new RetentionSimulator();
const earningsPredictor = new MonetizationPredictor();
const abTesting = new ABTestingService();
const uploadTimeOpt = new UploadTimeOptimizer();
const qualityService = new ContentQualityService();

export async function scanViralOpportunities(req: Request, res: Response) {
  try {
    const opportunities = await viralService.scanOpportunities();
    res.json({ success: true, data: opportunities });
  } catch (error: any) {
    logger.warn('Viral opportunity scan had issues, returning partial results', { error: error.message });
    const cached = await viralService.getTopOpportunities(5).catch(() => []);
    res.json({ success: true, data: cached, message: 'Used cached results (live scan unavailable)' });
  }
}

export async function getViralOpportunities(req: Request, res: Response) {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const niche = req.query.niche as string | undefined;
    const opportunities = await viralService.getTopOpportunities(limit, niche);
    res.json({ success: true, data: opportunities });
  } catch (error: any) {
    logger.error('Failed to get viral opportunities', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get opportunities' });
  }
}

export async function extractWinningPatterns(req: Request, res: Response) {
  try {
    const { transcript, title, videoId } = req.body;
    await patternsService.extractFromTranscript(transcript, title, videoId);
    res.json({ success: true, message: 'Patterns extracted successfully' });
  } catch (error: any) {
    logger.error('Failed to extract patterns', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to extract patterns' });
  }
}

export async function getWinningPatterns(req: Request, res: Response) {
  try {
    const category = req.query.category as any;
    const niche = req.query.niche as string | undefined;
    const limit = parseInt(req.query.limit as string) || 10;
    const patterns = await patternsService.getTopPatterns(category, niche, limit);
    res.json({ success: true, data: patterns });
  } catch (error: any) {
    logger.error('Failed to get patterns', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get patterns' });
  }
}

export async function scoreRetention(req: Request, res: Response) {
  try {
    const { scriptContent, format } = req.body;
    const score = await retOptimizer.scoreScript(scriptContent, format || 'Longform');
    res.json({ success: true, data: score });
  } catch (error: any) {
    logger.error('Retention scoring failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Retention scoring failed' });
  }
}

export async function optimizeScriptRetention(req: Request, res: Response) {
  try {
    const { scriptContent } = req.body;
    const score = await retOptimizer.scoreScript(scriptContent, 'Longform');
    const optimized = await retOptimizer.optimizeScript(scriptContent, score);
    res.json({ success: true, data: { originalScore: score, optimizedScript: optimized } });
  } catch (error: any) {
    logger.error('Script optimization failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Script optimization failed' });
  }
}

export async function generateThumbnailVariants(req: Request, res: Response) {
  try {
    const { topic, hook, projectId, niche } = req.body;
    const variants = await thumbOptimizer.generateVariants(topic, hook, projectId, niche);
    const best = await thumbOptimizer.pickBestVariant(variants);
    res.json({ success: true, data: { variants, best } });
  } catch (error: any) {
    logger.error('Thumbnail variant generation failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Thumbnail generation failed' });
  }
}

export async function generateTitleVariants(req: Request, res: Response) {
  try {
    const { topic, hook, niche } = req.body;
    const variants = await tOptimizer.generateVariants(topic, hook, niche);
    const best = await tOptimizer.pickBestVariant(variants);
    res.json({ success: true, data: { variants, best } });
  } catch (error: any) {
    logger.error('Title variant generation failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Title generation failed' });
  }
}

export async function getMonetizationReport(req: Request, res: Response) {
  try {
    const channelId = req.query.channelId as string;
    const userId = (req as any).userId;

    if (channelId) {
      const report = await monService.generateReport(channelId);
      return res.json({ success: true, data: report });
    }

    const reports = await monService.getEarningsByChannel(userId);
    res.json({ success: true, data: reports });
  } catch (error: any) {
    logger.error('Monetization report failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get monetization data' });
  }
}

export async function runPostUploadAnalysis(req: Request, res: Response) {
  try {
    const { projectId } = req.body;
    const analysis = await feedbackService.analyzeAfterUpload(projectId);
    await feedbackService.updateScriptPromptsBasedOnPerformance(projectId);
    res.json({ success: true, data: analysis });
  } catch (error: any) {
    logger.error('Post-upload analysis failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Post-upload analysis failed' });
  }
}

export async function createUploadSchedule(req: Request, res: Response) {
  try {
    const userId = (req as any).userId;
    const schedule = await scheduler.createSchedule({ ...req.body, userId });
    res.json({ success: true, data: schedule });
  } catch (error: any) {
    logger.error('Failed to create schedule', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to create schedule' });
  }
}

export async function getStrategy(req: Request, res: Response) {
  try {
    const niche = req.params.niche as string;
    const strategy = await stratEngine.getOrCreateStrategy(niche);
    res.json({ success: true, data: strategy });
  } catch (error: any) {
    logger.error('Failed to get strategy', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get strategy' });
  }
}

export async function listStrategies(req: Request, res: Response) {
  try {
    const userId = (req as any).userId;
    const strategies = await stratEngine.listStrategies(userId);
    res.json({ success: true, data: strategies });
  } catch (error: any) {
    logger.error('Failed to list strategies', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to list strategies' });
  }
}

export async function cleanupProject(req: Request, res: Response) {
  try {
    const { projectId } = req.body;
    const bytes = await cleanupService.getStorageSavings(projectId);
    await cleanupService.cleanupAfterUpload(projectId);
    res.json({ success: true, data: { bytesFreed: bytes, message: 'Project files cleaned up' } });
  } catch (error: any) {
    logger.error('Cleanup failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Cleanup failed' });
  }
}

export async function getBusinessDashboard(req: Request, res: Response) {
  try {
    const userId = (req as any).userId;
    const channelId = req.query.channelId as string | undefined;

    const [opportunities, strategies, earnings, patterns] = await Promise.all([
      viralService.getTopOpportunities(5),
      stratEngine.listStrategies(userId),
      monService.getEarningsByChannel(userId),
      patternsService.getTopPatterns(undefined, undefined, 5),
    ]);

    const topNiche = (Array.isArray(strategies) && strategies.length > 0)
      ? (strategies[0] as any)?.niche || 'General'
      : 'General';

    const [ctrPrediction, retentionSimulation, earningsPrediction, uploadTimeRec] = await Promise.all([
      ctrPredictor.predictThumbnailCTR('auto', topNiche, topNiche).catch(() => null),
      retentionSim.simulate('Sample script content for dashboard preview.', 'Longform', topNiche).catch(() => null),
      earningsPredictor.predictEarnings(topNiche, topNiche).catch(() => null),
      channelId ? uploadTimeOpt.getBestTime(channelId).catch(() => null) : Promise.resolve(null),
    ]);

    res.json({
      success: true,
      data: {
        topOpportunities: opportunities,
        strategies,
        earnings,
        topPatterns: patterns,
        predictions: {
          thumbnailCTR: ctrPrediction,
          retention: retentionSimulation,
          earnings: earningsPrediction,
          bestUploadTime: uploadTimeRec,
        },
      },
    });
  } catch (error: any) {
    logger.error('Business dashboard failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to load dashboard' });
  }
}

export async function predictThumbnailCTRHandler(req: Request, res: Response) {
  try {
    const { style, topic, niche } = req.body;
    const prediction = await ctrPredictor.predictThumbnailCTR(style, topic, niche);
    res.json({ success: true, data: prediction });
  } catch (error: any) {
    logger.error('CTR prediction failed', { error: error.message });
    res.status(500).json({ success: false, message: 'CTR prediction failed' });
  }
}

export async function predictTitleCTRHandler(req: Request, res: Response) {
  try {
    const { title, topic, niche } = req.body;
    const prediction = await ctrPredictor.predictTitleCTR(title, topic, niche);
    res.json({ success: true, data: prediction });
  } catch (error: any) {
    logger.error('Title CTR prediction failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Title CTR prediction failed' });
  }
}

export async function simulateRetentionHandler(req: Request, res: Response) {
  try {
    const { scriptContent, format, niche } = req.body;
    const simulation = await retentionSim.simulate(scriptContent, format || 'Longform', niche);
    res.json({ success: true, data: simulation });
  } catch (error: any) {
    logger.error('Retention simulation failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Retention simulation failed' });
  }
}

export async function getRetentionCurveHandler(req: Request, res: Response) {
  try {
    const projectId = req.params.projectId as string;
    const curve = await retentionSim.getRetentionCurve(projectId);
    res.json({ success: true, data: curve });
  } catch (error: any) {
    logger.error('Failed to get retention curve', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get retention curve' });
  }
}

export async function predictEarningsHandler(req: Request, res: Response) {
  try {
    const { topic, niche, country } = req.body;
    const prediction = await earningsPredictor.predictEarnings(topic, niche, country || 'US');
    res.json({ success: true, data: prediction });
  } catch (error: any) {
    logger.error('Earnings prediction failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Earnings prediction failed' });
  }
}

export async function createABTestHandler(req: Request, res: Response) {
  try {
    const { projectId, testType, variantA, variantB } = req.body;
    const test = await abTesting.createTest(projectId, testType, variantA, variantB);
    res.json({ success: true, data: test });
  } catch (error: any) {
    logger.error('AB test creation failed', { error: error.message });
    res.status(500).json({ success: false, message: 'AB test creation failed' });
  }
}

export async function recordABTestResultHandler(req: Request, res: Response) {
  try {
    const { testId, variant, impressions, clicks, retention } = req.body;
    await abTesting.recordResult(testId, variant, impressions, clicks, retention);
    const test = await abTesting.calculateWinner(testId);
    res.json({ success: true, data: test });
  } catch (error: any) {
    logger.error('AB test result recording failed', { error: error.message });
    res.status(500).json({ success: false, message: 'AB test result recording failed' });
  }
}

export async function getABTestsByProjectHandler(req: Request, res: Response) {
  try {
    const projectId = req.params.projectId as string;
    const tests = await abTesting.getTestsByProject(projectId);
    res.json({ success: true, data: tests });
  } catch (error: any) {
    logger.error('Failed to get AB tests', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get AB tests' });
  }
}

export async function getBestABTestVariantHandler(req: Request, res: Response) {
  try {
    const testType = req.params.testType as any;
    const variant = await abTesting.getBestPerformingVariant(testType);
    res.json({ success: true, data: { testType, bestVariant: variant } });
  } catch (error: any) {
    logger.error('Failed to get best variant', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get best variant' });
  }
}

export async function getBestUploadTimeHandler(req: Request, res: Response) {
  try {
    const channelId = req.params.channelId as string;
    const timezone = (req.query.timezone as string) || 'UTC';
    const recommendation = await uploadTimeOpt.getBestTime(channelId, timezone);
    res.json({ success: true, data: recommendation });
  } catch (error: any) {
    logger.error('Failed to get best upload time', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get best upload time' });
  }
}

export async function trackUploadTimePerformanceHandler(req: Request, res: Response) {
  try {
    const userId = (req as any).userId;
    const { channelId, uploadHour, uploadDay, views, ctr, retention } = req.body;
    await uploadTimeOpt.trackPerformance(channelId, userId, uploadHour, uploadDay, views, ctr, retention);
    res.json({ success: true, message: 'Upload time performance tracked' });
  } catch (error: any) {
    logger.error('Failed to track upload time', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to track upload time' });
  }
}

export async function humanizeScriptHandler(req: Request, res: Response) {
  try {
    const { scriptContent, format, niche } = req.body;
    const result = await qualityService.humanizeScript(scriptContent, format || 'Longform', niche);
    res.json({ success: true, data: { script: result } });
  } catch (error: any) {
    logger.error('Script humanization failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Script humanization failed' });
  }
}

export async function enhanceScriptEmotionHandler(req: Request, res: Response) {
  try {
    const { scriptContent } = req.body;
    const result = await qualityService.addEmotionalDepth(scriptContent);
    res.json({ success: true, data: { script: result } });
  } catch (error: any) {
    logger.error('Emotional enhancement failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Emotional enhancement failed' });
  }
}

export async function enhanceScriptPacingHandler(req: Request, res: Response) {
  try {
    const { scriptContent, format } = req.body;
    const result = await qualityService.improvePacing(scriptContent, format || 'Longform');
    res.json({ success: true, data: { script: result } });
  } catch (error: any) {
    logger.error('Pacing enhancement failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Pacing enhancement failed' });
  }
}

export async function enhanceScriptFullHandler(req: Request, res: Response) {
  try {
    const { scriptContent, format, niche } = req.body;
    const result = await qualityService.fullEnhance(scriptContent, format || 'Longform', niche);
    res.json({ success: true, data: { script: result } });
  } catch (error: any) {
    logger.error('Full script enhancement failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Full script enhancement failed' });
  }
}
