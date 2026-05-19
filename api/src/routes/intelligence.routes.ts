import { Router, Request, Response } from 'express';
import { GlobalIntelligenceEngine } from '../services/global-intelligence.engine';
import { CompetitorIntelligenceEngine } from '../services/competitor-intelligence.service';
import { ViralTopicFinder } from '../services/viral-topic-finder.service';
import { CrossChannelIntelligence } from '../services/cross-channel-intelligence.service';
import { ContentStrategyEngine } from '../services/content-strategy.service';
import { authenticate } from '../middleware/auth';

const router = Router();
const globalIntel = new GlobalIntelligenceEngine();
const competitorIntel = new CompetitorIntelligenceEngine();
const topicFinder = new ViralTopicFinder();
const crossChannelIntel = new CrossChannelIntelligence();
const contentStrategy = new ContentStrategyEngine();

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

export default router;
