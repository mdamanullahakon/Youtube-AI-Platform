import { Router, Request, Response } from 'express';
import { GlobalIntelligenceEngine } from '../services/global-intelligence.engine';
import { CompetitorIntelligenceEngine } from '../services/competitor-intelligence.service';
import { ViralTopicFinder } from '../services/viral-topic-finder.service';
import { CrossChannelIntelligence } from '../services/cross-channel-intelligence.service';
import { ContentStrategyEngine } from '../services/content-strategy.service';
import { TestingEngine } from '../services/testing-engine.service';
import { QAEngine } from '../services/qa-engine.service';
import { ReportingEngine } from '../services/reporting-engine.service';
import { SelfImprovingContentEngine } from '../services/self-improving-content.service';
import { AnalyticsEngineV2 } from '../services/analytics-engine-v2.service';
import { authenticate } from '../middleware/auth';

const router = Router();
const globalIntel = new GlobalIntelligenceEngine();
const competitorIntel = new CompetitorIntelligenceEngine();
const topicFinder = new ViralTopicFinder();
const crossChannelIntel = new CrossChannelIntelligence();
const contentStrategy = new ContentStrategyEngine();
const testingEngine = new TestingEngine();
const qaEngine = new QAEngine();
const reportingEngine = new ReportingEngine();
const selfImproveEngine = new SelfImprovingContentEngine();
const analyticsV2 = new AnalyticsEngineV2();

// POST /api/intelligence/daily-cycle — Run full daily intelligence cycle
router.post('/daily-cycle', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || req.body.userId;
    const niches = req.body.niches || ['horror', 'paranormal', 'true crime', 'unsolved mysteries'];
    const report = await globalIntel.runDailyCycle(userId, niches);
    res.json({ success: true, data: report });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/intelligence/competitors/:niche/cached — Get cached competitor analysis
router.get('/competitors/:niche/cached', authenticate, async (req: Request, res: Response) => {
  try {
    const niche = typeof req.params.niche === 'string' ? req.params.niche : '';
    const cached = await competitorIntel.getLatestInsights(niche);
    res.json({ success: true, data: cached || null });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/intelligence/competitors/:niche — Analyze competitors for a niche
router.get('/competitors/:niche', authenticate, async (req: Request, res: Response) => {
  try {
    const niche = typeof req.params.niche === 'string' ? req.params.niche : '';
    const channels = typeof req.query.channels === 'string' ? req.query.channels : '5';
    const analysis = await competitorIntel.analyzeNiche(niche, parseInt(channels) || 5);
    res.json({ success: true, data: analysis });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/intelligence/topics — Get top viral topic ideas
router.get('/topics', authenticate, async (req: Request, res: Response) => {
  try {
    const nichesStr = req.query.niches;
    const niches = typeof nichesStr === 'string' ? nichesStr.split(',') : ['horror', 'paranormal', 'true crime'];
    const topics = await topicFinder.findDailyTopics(niches);
    res.json({ success: true, data: topics.slice(0, 10) });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/intelligence/cross-channel — Cross-channel intelligence
router.get('/cross-channel', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (typeof req.query.userId === 'string' ? req.query.userId : '');
    const strategy = await crossChannelIntel.analyzeAllChannels(userId);
    res.json({ success: true, data: strategy });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/intelligence/health — System health check
router.get('/health', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (typeof req.query.userId === 'string' ? req.query.userId : '');
    const health = await globalIntel.getSystemHealth(userId);
    res.json({ success: true, data: health });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/intelligence/strategy/:channelId — Generate strategy for a channel
router.post('/strategy/:channelId', authenticate, async (req: Request, res: Response) => {
  try {
    const channelId = typeof req.params.channelId === 'string' ? req.params.channelId : '';
    const userId = (req as any).user?.id || req.body.userId;
    const strategy = await contentStrategy.generateStrategy(channelId, userId);
    res.json({ success: true, data: strategy });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Testing Engine Routes ─────────────────────────────────────────

// POST /api/intelligence/testing/variants — Generate A/B variants
router.post('/testing/variants', authenticate, async (req: Request, res: Response) => {
  try {
    const { topic, hook, niche } = req.body;
    const variants = await testingEngine.generateVariants(topic, hook, niche || 'horror');
    res.json({ success: true, data: variants });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/intelligence/testing/record — Record A/B test result
router.post('/testing/record', authenticate, async (req: Request, res: Response) => {
  try {
    const { projectId, testType, variantA, variantB, result } = req.body;
    const recorded = await testingEngine.recordTestResult(projectId, testType, variantA, variantB, result);
    res.json({ success: true, data: recorded });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/intelligence/testing/winner/:projectId — Get winner for project
router.get('/testing/winner/:projectId', authenticate, async (req: Request, res: Response) => {
  try {
    const projectId = typeof req.params.projectId === 'string' ? req.params.projectId : '';
    const winner = await testingEngine.getWinnerForProject(projectId);
    res.json({ success: true, data: winner || null });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/intelligence/testing/learnings — Get global A/B learnings
router.get('/testing/learnings', authenticate, async (req: Request, res: Response) => {
  try {
    const niche = typeof req.query.niche === 'string' ? req.query.niche : undefined;
    const learnings = await testingEngine.getGlobalLearnings(niche);
    res.json({ success: true, data: learnings });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── QA Engine Routes ──────────────────────────────────────────────

// POST /api/intelligence/qa/validate — Validate video before upload
router.post('/qa/validate', authenticate, async (req: Request, res: Response) => {
  try {
    const { scriptContent, scenes, totalDurationSeconds, thumbnailPrompt, title } = req.body;
    const qaResult = await qaEngine.validateVideo(scriptContent, scenes, totalDurationSeconds, thumbnailPrompt, title);
    res.json({ success: true, data: qaResult });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/intelligence/qa/autofix — Auto-fix video issues
router.post('/qa/autofix', authenticate, async (req: Request, res: Response) => {
  try {
    const { scriptContent, scenes, qaResult } = req.body;
    const fixed = await qaEngine.autoFix(scriptContent, scenes, qaResult);
    res.json({ success: true, data: fixed });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Reporting Engine Routes ───────────────────────────────────────

// GET /api/intelligence/reports/video/:projectId — Video-level report
router.get('/reports/video/:projectId', authenticate, async (req: Request, res: Response) => {
  try {
    const projectId = typeof req.params.projectId === 'string' ? req.params.projectId : '';
    const report = await reportingEngine.generateVideoReport(projectId);
    res.json({ success: true, data: report });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/intelligence/reports/daily — Daily report
router.get('/reports/daily', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (typeof req.query.userId === 'string' ? req.query.userId : '');
    const report = await reportingEngine.generateDailyReport(userId);
    res.json({ success: true, data: report });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/intelligence/reports/weekly — Weekly report
router.get('/reports/weekly', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (typeof req.query.userId === 'string' ? req.query.userId : '');
    const report = await reportingEngine.generateWeeklyReport(userId);
    res.json({ success: true, data: report });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Self-Improving Content Engine Routes ──────────────────────────

// POST /api/intelligence/self-improve/analyze — Analyze video performance
router.post('/self-improve/analyze', authenticate, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.body;
    const analysis = await selfImproveEngine.analyzeVideoPerformance(projectId);
    res.json({ success: true, data: analysis });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/intelligence/self-improve/improve-script — Improve script from past learnings
router.post('/self-improve/improve-script', authenticate, async (req: Request, res: Response) => {
  try {
    const { scriptContent, projectId } = req.body;
    const improved = await selfImproveEngine.improveScript(scriptContent, projectId);
    res.json({ success: true, data: { improvedScript: improved } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/intelligence/self-improve/patterns/:niche — Get learned patterns
router.get('/self-improve/patterns/:niche', authenticate, async (req: Request, res: Response) => {
  try {
    const niche = typeof req.params.niche === 'string' ? req.params.niche : '';
    const patterns = await selfImproveEngine.getLearnedPatterns(niche);
    res.json({ success: true, data: patterns });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Analytics V2 Routes ───────────────────────────────────────────

// GET /api/intelligence/analytics/video/:projectId — Deep video analytics
router.get('/analytics/video/:projectId', authenticate, async (req: Request, res: Response) => {
  try {
    const projectId = typeof req.params.projectId === 'string' ? req.params.projectId : '';
    const analytics = await analyticsV2.getVideoAnalyticsDeep(projectId);
    res.json({ success: true, data: analytics || null });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/intelligence/analytics/channel/:channelId — Channel growth metrics
router.get('/analytics/channel/:channelId', authenticate, async (req: Request, res: Response) => {
  try {
    const channelId = typeof req.params.channelId === 'string' ? req.params.channelId : '';
    const growth = await analyticsV2.getChannelGrowth(channelId);
    res.json({ success: true, data: growth });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/intelligence/analytics/decay/:channelId — Content decay detection
router.get('/analytics/decay/:channelId', authenticate, async (req: Request, res: Response) => {
  try {
    const channelId = typeof req.params.channelId === 'string' ? req.params.channelId : '';
    const threshold = typeof req.query.threshold === 'string' ? parseInt(req.query.threshold) : 14;
    const decaying = await analyticsV2.detectDecayingContent(channelId, threshold);
    res.json({ success: true, data: decaying });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/intelligence/analytics/growth-trends — Multi-channel growth trends
router.get('/analytics/growth-trends', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (typeof req.query.userId === 'string' ? req.query.userId : '');
    const trends = await analyticsV2.getGrowthTrends(userId);
    res.json({ success: true, data: trends });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
