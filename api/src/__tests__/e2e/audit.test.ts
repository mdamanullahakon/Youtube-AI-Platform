import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// HOISTED HELPERS
// ═══════════════════════════════════════════════════════════════

const prismaMock = vi.hoisted(() => {
  const models = [
    'youTubeAccount', 'channelMetrics', 'videoProject', 'analytics',
    'uploadHistory', 'user', 'aIUsage',
  ];
  const methods = ['findUnique', 'findFirst', 'findMany', 'create', 'update', 'upsert', 'delete', 'count', 'aggregate'];
  const mock: Record<string, any> = {};
  for (const model of models) {
    mock[model] = {};
    for (const method of methods) {
      mock[model][method] = vi.fn();
    }
  }
  mock.$disconnect = vi.fn();
  mock.$connect = vi.fn();
  mock.$transaction = vi.fn();
  mock.$use = vi.fn();
  return mock;
});

// ═══════════════════════════════════════════════════════════════
// MOCK ALL EXTERNAL DEPENDENCIES
// ═══════════════════════════════════════════════════════════════

vi.mock('../../config/db', () => ({
  prisma: prismaMock,
  disconnectDatabase: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  aiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  queueLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  pipelineLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../config/env', () => ({
  env: {
    PORT: 4000,
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-min-32-chars-long-!!',
    GEMINI_API_KEY: '',
    OLLAMA_HOST: 'http://localhost:11434',
    OLLAMA_MODEL: 'llama3',
    YOUTUBE_CLIENT_ID: 'mock-client-id',
    YOUTUBE_CLIENT_SECRET: 'mock-client-secret',
    YOUTUBE_REFRESH_TOKEN: 'mock-refresh-token',
    YOUTUBE_API_KEY: 'mock-api-key',
    OAUTH_STATE_SECRET: 'mock-state-secret',
    ENCRYPTION_KEY: 'mock-encryption-key',
  },
}));

// Mock redis for AI service
vi.mock('ioredis', () => {
  function MockIORedis(url?: string, options?: any) {
    return {
      on: vi.fn().mockReturnThis(),
      once: vi.fn().mockReturnThis(),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue('OK'),
      ping: vi.fn().mockResolvedValue('PONG'),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      setex: vi.fn().mockResolvedValue('OK'),
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      status: 'ready',
    };
  }
  return { default: MockIORedis };
});

vi.mock('../../config/redis', () => ({
  redisConnection: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue('OK'),
    status: 'ready',
    on: vi.fn().mockReturnThis(),
  },
  detectRedisVersion: vi.fn().mockResolvedValue(7),
  isRedisCompatible: vi.fn().mockReturnValue(true),
  disconnectRedis: vi.fn(),
}));

// Mock circuit breaker service
vi.mock('../../services/circuit-breaker.service', () => ({
  aiBreaker: vi.fn().mockReturnValue({
    call: vi.fn().mockImplementation((fn: Function) => fn()),
    status: 'closed',
    stats: { success: 0, failure: 0 },
  }),
}));

// Mock AI usage (rate limit tracking)
vi.mock('../../services/ai-usage.service', () => ({
  AIUsageService: {
    track: vi.fn(),
    checkDailyLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 100, limit: 100 }),
    getDailyUsage: vi.fn().mockResolvedValue({ count: 0, tokens: 0, cost: 0 }),
  },
}));

// Mock prompt sanitizer
vi.mock('../../utils/prompt-sanitizer', () => ({
  sanitizePrompt: vi.fn().mockReturnValue({ sanitized: 'mock prompt', blocked: false }),
}));

// Mock token estimator
vi.mock('../../utils/token-estimator', () => ({
  estimateTokens: vi.fn().mockReturnValue(100),
  estimateCost: vi.fn().mockReturnValue(0.001),
}));

// Mock the AI service directly so generateWithAI is a vi.fn()
vi.mock('../../services/ai.service', () => ({
  generateWithAI: vi.fn(),
}));

// Mock axios (used by AI service internally, but we mock ai.service directly above)
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    create: vi.fn().mockReturnThis(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

// ═══════════════════════════════════════════════════════════════
// IMPORT TESTED MODULES
// ═══════════════════════════════════════════════════════════════

import { generateWithAI } from '../../services/ai.service';
import { ChannelAuditService } from '../../services/channel-audit.service';
import { ChannelOptimizerService } from '../../services/channel-optimizer.service';
import type { ChannelAuditReport, AuditInput } from '../../services/channel-audit.service';
import type { OptimizationOutput, OptimizerInput } from '../../services/channel-optimizer.service';

// ═══════════════════════════════════════════════════════════════
// MOCK DATA HELPERS
// ═══════════════════════════════════════════════════════════════

function mockChannelAccount(overrides: Record<string, any> = {}) {
  return {
    id: 'yt-acc-audit-1',
    userId: 'user-audit-1',
    channelId: 'UC-audit-test-channel',
    channelTitle: 'TechExplained',
    channelAvatar: 'https://yt3.googleusercontent.com/mock-avatar',
    isConnected: true,
    niche: 'Technology',
    accessToken: 'mock-token',
    refreshToken: 'mock-refresh',
    tokenExpiresAt: new Date(Date.now() + 3600000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockChannelMetrics(overrides: Record<string, any> = {}) {
  return {
    id: 'metrics-audit-1',
    channelId: 'UC-audit-test-channel',
    subscribers: 15000,
    totalViews: 850000,
    totalVideos: 120,
    avgCTR: 6.5,
    avgRetention: 45.2,
    subscriberGrowth: 320,
    monthlyViews: 45000,
    monthlyWatchHours: 3200,
    estimatedRPM: 4.50,
    estimatedCPM: 2.30,
    estimatedEarnings: 202.50,
    topNiche: 'Tech Enthusiasts',
    ...overrides,
  };
}

function mockVideoProject(idx: number, overrides: Record<string, any> = {}) {
  return {
    id: `video-project-${idx}`,
    userId: 'user-audit-1',
    channelId: 'UC-audit-test-channel',
    topic: `Video Topic ${idx}`,
    title: `Amazing Tech Video ${idx} That Will Blow Your Mind`,
    status: 'published',
    createdAt: new Date(Date.now() - idx * 86400000),
    updatedAt: new Date(),
    analytics: {
      id: `analytics-${idx}`,
      projectId: `video-project-${idx}`,
      views: 50000 - idx * 3000,
      likes: 3000 - idx * 200,
      comments: 400 - idx * 30,
      ctr: 7.0 - idx * 0.3,
      retention: 50.0 - idx * 2.0,
      watchTime: 25000 - idx * 1500,
    },
    uploadHistory: {
      id: `uh-${idx}`,
      projectId: `video-project-${idx}`,
      videoId: `yt-video-${idx}`,
      status: 'uploaded',
      publishedAt: new Date(Date.now() - idx * 86400000),
    },
    ...overrides,
  };
}

// Sample AI-generated audit report (simulating what the AI would return)
const MOCK_AUDIT_REPORT_JSON: ChannelAuditReport = {
  niche_analysis: {
    actualNiche: 'Technology Education',
    expectedNiche: 'Technology',
    matchScore: 85,
    mismatchReasons: ['Channel covers broader tech education, not just news'],
    nicheClarityLevel: 'Clear',
  },
  branding: {
    brandingScore: 72,
    issues: ['Banner lacks clear value proposition', 'Logo is generic tech icon'],
    emotionalImpactLevel: 'Medium',
  },
  seo: {
    seoScore: 65,
    missingKeywords: ['machine learning', 'programming tutorials', 'tech reviews'],
    keywordOpportunities: ['AI for beginners', 'coding tips', 'tech news weekly'],
  },
  content_strategy: {
    contentStrategyScore: 78,
    viralPotentialRating: 'High potential in tutorials and reviews',
    contentGaps: ['No short-form content', 'Lack of series/playlists'],
  },
  ctr_retention: {
    ctrScore: 70,
    retentionScore: 55,
    keyDropOffRisks: ['First 15 seconds lack hook', 'Middle section pacing too slow'],
  },
  competitor_analysis: {
    weaknessVsCompetitors: ['Less frequent uploads', 'Thumbnails less clickable'],
    opportunitiesToOutperform: ['Unique tutorial angles', 'Better storytelling'],
  },
  action_plan: {
    quick_fixes: ['Optimize channel banner with clear value prop', 'Add end screens to all videos'],
    high_impact_fixes: ['Create a content calendar for consistent uploads', 'Improve thumbnail design with face close-ups'],
    long_term_strategy: ['Build a series on AI fundamentals', 'Collaborate with complementary channels'],
    suggestedDescription: 'Welcome to TechExplained — your go-to source for understanding cutting-edge technology. From AI tutorials to in-depth tech reviews, we make complex topics simple and exciting.\n\n📚 New videos every Tuesday and Friday!\n🔔 Subscribe and hit the bell to never miss an upload.\n💬 Join the discussion in the comments!',
    suggestedTags: ['technology', 'tech explained', 'ai tutorial', 'machine learning', 'programming', 'coding', 'tech reviews', 'gadgets', 'future tech', 'science'],
    suggestedChannelName: 'TechExplained Pro',
    bannerTextSuggestion: 'Headline: "Tech Made Simple" | Subheadline: "AI, Coding & Reviews — Weekly"',
    logoConceptSuggestion: 'Minimalist letter T with circuit board patterns, using gradient blue-to-purple color scheme',
  },
  final_score: 74,
  summary: 'TechExplained is a solid tech education channel with good content but needs branding and SEO improvements to reach its full viral potential.',
};

const MOCK_OPTIMIZATION_JSON: OptimizationOutput = {
  niche_positioning: 'TechExplained — the most accessible AI and coding education channel for beginners and intermediates.',
  optimized_description: '🧠 STOP scrolling and START learning.\n\nTechExplained breaks down AI, coding, and future tech into simple 10-minute lessons. No fluff, no jargon — just pure knowledge you can use.\n\n🚀 What you get:\n• AI tutorials that actually make sense\n• Coding tips used by FAANG engineers\n• Tech reviews that save you money\n• Weekly breakdowns of breakthrough tech\n\n📅 New video every Tuesday & Friday\n🔔 Subscribe NOW — your future self will thank you\n💬 Join 15,000+ smart learners in the comments',
  optimized_tags: [
    'technology', 'tech explained', 'ai tutorial', 'machine learning for beginners',
    'coding tips', 'programming', 'python tutorial', 'tech reviews', 'gadgets',
    'future technology', 'artificial intelligence', 'learn to code', 'tech news',
    'software engineering', 'web development', 'data science', 'computer science',
    'ai tools', 'chatgpt tutorial', 'productivity', 'tech trends 2026',
    'how to start coding', 'beginner programming', 'tech education', 'stem',
    'innovation', 'digital transformation', 'smart home tech', 'cybersecurity basics',
    'cloud computing',
  ],
  name_suggestions: ['TechExplained Pro', 'TechSimple', 'ByteWise', 'Code & Circuit', 'The Tech Lab'],
  banner_text: {
    headline: 'Tech Made Simple',
    subheadline: 'AI • Coding • Reviews — Weekly Deep Dives',
  },
  logo_concept: 'A minimalist letter "T" constructed from subtle circuit board traces in gradient blue (#2563EB) to purple (#7C3AED). The design should feel modern, clean, and educational — reminiscent of a stylized motherboard trace. White background for versatility.',
  viral_video_ideas: [
    'I Used AI to Code an App in 10 Minutes (Results Shocked Me)',
    'The AI Tool That Replaces 10 Engineers — Should You Worry?',
    'I Analyzed 100 Viral Tech Videos — Here\'s the Secret Formula',
    'This Simple Python Script Made Me $500/Month Passive Income',
    'The Truth About AI in 2026 (No Hype, Just Facts)',
    '5 Coding Projects That Will Get You Hired in 2026 (No Degree Needed)',
    'I Tried Every AI Code Editor — The Winner Will Surprise You',
    'How Tech Billionaires Think (7 Mental Models They Use)',
    'The Hidden Setting on Your Phone That Changes Everything',
    'I Built a Startup in 24 Hours Using Only AI Tools (Full Breakdown)',
  ],
  seo_boost: {
    keywordsToTarget: [
      'AI tutorial for beginners',
      'how to learn coding 2026',
      'tech news weekly roundup',
      'programming projects for beginners',
      'AI explained simply',
      'best tech gadgets 2026',
      'learn python from scratch',
      'tech review honest',
    ],
    hashtagStrategy: 'Use 3 high-volume tags + 2 niche tags per video. Primary: #TechExplained #AI #Coding. Secondary: #[topic-specific] #LearnWithMe. Avoid generic #viral or #fyp. Place first 3 hashtags in description, last 2 in first comment.',
  },
  monetization_plan: '1) Affiliate marketing: Promote coding courses (DataCamp, Coursera) and tech gadgets with affiliate links in description. 2) Sponsorships: Target VPN, hosting, and dev tool companies once hitting 50K subs. 3) Digital products: Sell a "Learn Python in 30 Days" ebook/notion template. 4) Memberships: Offer exclusive coding challenges and early access for $4.99/month. 5) Course platform: Bundle tutorials into a premium course on Udemy/Skillshare.',
  transformation_summary: 'Complete channel overhaul applied: SEO-optimized description, 30 targeted tags, 10 viral video ideas, affiliate-ready monetization strategy, and rebranded positioning as "the most accessible tech education channel."',
  confidence_score: 88,
  before_vs_after: {
    whatWasWrong: [
      'Channel description was generic and lacked keywords',
      'Only 5 basic tags used',
      'No content series or consistent upload schedule',
      'Thumbnails lacked face close-ups and emotional triggers',
      'No monetization strategy beyond AdSense',
    ],
    whatIsFixed: [
      'SEO-optimized description with keywords and CTA',
      '30 targeted high-ranking tags generated',
      '10 viral video ideas with CTR-optimized titles',
      'Banner text redesigned with clear value prop',
      'Multi-stream monetization plan created',
    ],
    expectedImprovement: 'Estimated 40-60% improvement in CTR (from ~6.5% to 9-10%), 25-35% increase in watch time through better hooks and pacing, 50%+ growth in subscriber conversion from optimized CTA and branding.',
  },
};

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

describe('Channel Audit E2E', () => {
  let auditService: ChannelAuditService;
  let optimizerService: ChannelOptimizerService;

  beforeEach(() => {
    vi.clearAllMocks();
    auditService = new ChannelAuditService();
    optimizerService = new ChannelOptimizerService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 1: Full Audit Flow
  // ──────────────────────────────────────────────────────────
  describe('1. Full Audit Flow', () => {
    it('should execute a complete channel audit and return a structured report', async () => {
      // ── Arrange ──
      const channelAccount = mockChannelAccount();
      const channelMetrics = mockChannelMetrics();
      const topVideos = Array.from({ length: 10 }, (_, i) => mockVideoProject(i + 1));
      const input: AuditInput = {
        channelId: 'UC-audit-test-channel',
        expectedNiche: 'Technology',
        channelDescription: 'Tech reviews and tutorials for everyone',
        channelTags: 'tech, coding, ai',
      };

      // Mock AI to return a valid audit report
      (generateWithAI as any).mockResolvedValue(JSON.stringify(MOCK_AUDIT_REPORT_JSON));

      // Mock Prisma
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(channelAccount);
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(channelMetrics);
      (prismaMock.videoProject.findMany as any).mockResolvedValue(topVideos);

      // ── Act ──
      const report = await auditService.runAudit(input);

      // ── Assert — Structure ──
      expect(report).toBeDefined();
      expect(report.final_score).toBe(74);
      expect(report.summary).toContain('TechExplained');

      // All 7 analysis layers present
      expect(report.niche_analysis).toBeDefined();
      expect(report.branding).toBeDefined();
      expect(report.seo).toBeDefined();
      expect(report.content_strategy).toBeDefined();
      expect(report.ctr_retention).toBeDefined();
      expect(report.competitor_analysis).toBeDefined();
      expect(report.action_plan).toBeDefined();

      // Assert — Niche analysis
      expect(report.niche_analysis.matchScore).toBe(85);
      expect(report.niche_analysis.actualNiche).toBe('Technology Education');
      expect(report.niche_analysis.nicheClarityLevel).toBe('Clear');

      // Assert — Branding
      expect(report.branding.brandingScore).toBe(72);
      expect(report.branding.issues.length).toBeGreaterThanOrEqual(1);

      // Assert — SEO
      expect(report.seo.seoScore).toBe(65);
      expect(report.seo.missingKeywords).toContain('machine learning');

      // Assert — Content Strategy
      expect(report.content_strategy.contentStrategyScore).toBe(78);
      expect(report.content_strategy.contentGaps.length).toBeGreaterThanOrEqual(1);

      // Assert — CTR & Retention
      expect(report.ctr_retention.ctrScore).toBe(70);
      expect(report.ctr_retention.retentionScore).toBe(55);

      // Assert — Action Plan with all required fields
      expect(report.action_plan.quick_fixes.length).toBeGreaterThanOrEqual(1);
      expect(report.action_plan.high_impact_fixes.length).toBeGreaterThanOrEqual(1);
      expect(report.action_plan.long_term_strategy.length).toBeGreaterThanOrEqual(1);
      expect(report.action_plan.suggestedDescription).toBeTruthy();
      expect(report.action_plan.suggestedTags.length).toBeGreaterThanOrEqual(1);
      expect(report.action_plan.suggestedChannelName).toBeTruthy();
      expect(report.action_plan.bannerTextSuggestion).toBeTruthy();
      expect(report.action_plan.logoConceptSuggestion).toBeTruthy();

      // ── Verify Prisma was called correctly ──
      expect(prismaMock.youTubeAccount.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { channelId: input.channelId } })
      );
      expect(prismaMock.channelMetrics.findFirst).toHaveBeenCalled();
      expect(prismaMock.videoProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { channelId: input.channelId, status: 'published' },
          take: 10,
        })
      );
    });

    it('should handle competitor channel data when provided', async () => {
      const channelAccount = mockChannelAccount();
      const channelMetrics = mockChannelMetrics();
      const topVideos = Array.from({ length: 5 }, (_, i) => mockVideoProject(i + 1));

      // Mock competitor data
      const competitorAccount = {
        ...mockChannelAccount({
          id: 'comp-yt-1',
          channelId: 'UC-competitor-channel',
          channelTitle: 'CompetitorTech',
          niche: 'Technology',
        }),
      };
      const competitorMetrics = {
        ...mockChannelMetrics({ channelId: 'UC-competitor-channel', subscribers: 50000, totalViews: 3000000 }),
      };
      const competitorVideos = Array.from({ length: 3 }, (_, i) => mockVideoProject(i + 1, {
        channelId: 'UC-competitor-channel',
        title: `Competitor Video ${i + 1}`,
      }));

      (generateWithAI as any).mockResolvedValue(JSON.stringify(MOCK_AUDIT_REPORT_JSON));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(channelAccount);
      (prismaMock.channelMetrics.findFirst as any)
        .mockResolvedValueOnce(channelMetrics)   // main channel metrics
        .mockResolvedValueOnce(competitorMetrics); // competitor metrics
      (prismaMock.videoProject.findMany as any)
        .mockResolvedValueOnce(topVideos)          // main channel videos
        .mockResolvedValueOnce(competitorVideos);  // competitor videos
      (prismaMock.youTubeAccount.findMany as any).mockResolvedValue([competitorAccount]);

      const report = await auditService.runAudit({
        channelId: 'UC-audit-test-channel',
        expectedNiche: 'Technology',
        competitorChannelIds: ['UC-competitor-channel'],
      });

      expect(report).toBeDefined();
      expect(report.final_score).toBe(74);
      expect(prismaMock.youTubeAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { channelId: { in: ['UC-competitor-channel'] } },
        })
      );
    });

    it('should throw when channel is not found', async () => {
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(null);

      await expect(auditService.runAudit({
        channelId: 'UC-nonexistent-channel',
      })).rejects.toThrow('YouTube channel UC-nonexistent-channel not found');
    });
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 2: Full Optimize Flow
  // ──────────────────────────────────────────────────────────
  describe('2. Full Optimize Flow', () => {
    it('should execute a complete channel optimization from audit report', async () => {
      const input: OptimizerInput = {
        auditReport: MOCK_AUDIT_REPORT_JSON,
        channelName: 'TechExplained',
        channelDescription: 'Tech reviews and tutorials for everyone',
        channelTags: 'tech, coding, ai, tutorial',
        channelBanner: 'https://yt3.googleusercontent.com/mock-banner',
        channelLogo: 'https://yt3.googleusercontent.com/mock-logo',
        targetNiche: 'Technology Education',
        targetAudience: 'Tech enthusiasts and beginners learning to code',
        competitorInsights: 'CompetitorTech has 50K subs, higher upload frequency, better thumbnails',
      };

      (generateWithAI as any).mockResolvedValue(JSON.stringify(MOCK_OPTIMIZATION_JSON));

      const result = await optimizerService.runOptimization(input);

      // Assert — All 10+ output fields present
      expect(result).toBeDefined();
      expect(result.niche_positioning).toContain('TechExplained');
      expect(result.confidence_score).toBe(88);

      // Assert — Niche positioning
      expect(result.niche_positioning).toBeTruthy();

      // Assert — Optimized description
      expect(result.optimized_description).toBeTruthy();
      expect(result.optimized_description).toContain('Subscribe');

      // Assert — Optimized tags (15-30)
      expect(result.optimized_tags.length).toBeGreaterThanOrEqual(15);
      expect(result.optimized_tags.length).toBeLessThanOrEqual(31);
      expect(result.optimized_tags).toContain('technology');

      // Assert — Name suggestions (3-5)
      expect(result.name_suggestions.length).toBeGreaterThanOrEqual(1);
      expect(result.name_suggestions.length).toBeLessThanOrEqual(5);

      // Assert — Banner text
      expect(result.banner_text.headline).toBeTruthy();
      expect(result.banner_text.subheadline).toBeTruthy();

      // Assert — Logo concept
      expect(result.logo_concept).toBeTruthy();

      // Assert — Viral video ideas (5-10)
      expect(result.viral_video_ideas.length).toBeGreaterThanOrEqual(5);
      expect(result.viral_video_ideas.length).toBeLessThanOrEqual(11);

      // Assert — SEO boost
      expect(result.seo_boost.keywordsToTarget.length).toBeGreaterThanOrEqual(1);
      expect(result.seo_boost.hashtagStrategy).toBeTruthy();

      // Assert — Monetization plan
      expect(result.monetization_plan).toBeTruthy();
      expect(result.monetization_plan).toContain('affiliate');

      // Assert — Before vs After
      expect(result.before_vs_after.whatWasWrong.length).toBeGreaterThanOrEqual(1);
      expect(result.before_vs_after.whatIsFixed.length).toBeGreaterThanOrEqual(1);
      expect(result.before_vs_after.expectedImprovement).toBeTruthy();
      expect(result.before_vs_after.expectedImprovement).toContain('CTR');

      // Assert — Transformation summary
      expect(result.transformation_summary).toBeTruthy();
    });
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 3: Audit → Optimize pipeline (full flow)
  // ──────────────────────────────────────────────────────────
  describe('3. Full Audit → Optimize Pipeline', () => {
    it('should run audit then use the report to run optimization', async () => {
      // ── Step 1: Run audit ──
      const channelAccount = mockChannelAccount();
      const channelMetrics = mockChannelMetrics();
      const topVideos = Array.from({ length: 10 }, (_, i) => mockVideoProject(i + 1));

      (generateWithAI as any).mockResolvedValueOnce(JSON.stringify(MOCK_AUDIT_REPORT_JSON));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(channelAccount);
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(channelMetrics);
      (prismaMock.videoProject.findMany as any).mockResolvedValue(topVideos);

      const report = await auditService.runAudit({
        channelId: 'UC-audit-test-channel',
        expectedNiche: 'Technology',
      });

      expect(report.final_score).toBe(74);
      expect(report.summary).toBeTruthy();

      // ── Step 2: Use audit report for optimization ──
      (generateWithAI as any).mockResolvedValueOnce(JSON.stringify(MOCK_OPTIMIZATION_JSON));

      const optimizeInput: OptimizerInput = {
        auditReport: report,
        channelName: 'TechExplained',
        channelDescription: 'Tech reviews and tutorials',
        channelTags: 'tech, coding, ai',
        channelBanner: 'https://yt3.googleusercontent.com/mock-banner',
        channelLogo: 'https://yt3.googleusercontent.com/mock-logo',
        targetNiche: 'Technology Education',
        targetAudience: 'Tech learners',
      };

      const optResult = await optimizerService.runOptimization(optimizeInput);

      expect(optResult.confidence_score).toBe(88);
      expect(optResult.optimized_tags.length).toBeGreaterThanOrEqual(15);
      expect(optResult.viral_video_ideas.length).toBeGreaterThanOrEqual(5);
      expect(optResult.before_vs_after.expectedImprovement).toContain('CTR');

      // ── Verify the flow: generateWithAI called twice ──
      expect(generateWithAI).toHaveBeenCalledTimes(2);
    });
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 4: Malformed / Fallback Handling
  // ──────────────────────────────────────────────────────────
  describe('4. Fallback & Error Handling', () => {
    it('should return fallback report when AI returns unparseable JSON (audit)', async () => {
      const channelAccount = mockChannelAccount();
      const channelMetrics = mockChannelMetrics();
      const topVideos = Array.from({ length: 3 }, (_, i) => mockVideoProject(i + 1));

      // AI returns invalid JSON
      (generateWithAI as any).mockResolvedValue('This is not valid JSON at all {broken');
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(channelAccount);
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(channelMetrics);
      (prismaMock.videoProject.findMany as any).mockResolvedValue(topVideos);

      const report = await auditService.runAudit({
        channelId: 'UC-audit-test-channel',
      });

      // Fallback report has default score of 50
      expect(report.final_score).toBe(50);
      expect(report.summary).toContain('could not be completed');
      expect(report.niche_analysis.matchScore).toBe(50);
      expect(report.branding.brandingScore).toBe(50);
      expect(report.action_plan.quick_fixes[0]).toContain('AI service');
    });

    it('should return fallback optimization when AI returns unparseable JSON (optimize)', async () => {
      (generateWithAI as any).mockResolvedValue('Definitely not JSON {{{broken');

      const result = await optimizerService.runOptimization({
        auditReport: MOCK_AUDIT_REPORT_JSON,
        channelName: 'TechExplained',
        channelDescription: '',
        channelTags: '',
        channelBanner: '',
        channelLogo: '',
        targetNiche: 'Technology',
        targetAudience: '',
      });

      expect(result.confidence_score).toBe(30);
      expect(result.transformation_summary).toContain('could not be completed');
      expect(result.name_suggestions).toContain('TechExplained');
      expect(result.viral_video_ideas[0]).toContain('AI unavailable');
    });

    it('should handle AI returning markdown-wrapped JSON in audit', async () => {
      const channelAccount = mockChannelAccount();
      const channelMetrics = mockChannelMetrics();
      const topVideos = Array.from({ length: 5 }, (_, i) => mockVideoProject(i + 1));

      const wrappedJson = [
        '```json',
        JSON.stringify(MOCK_AUDIT_REPORT_JSON),
        '```',
      ].join('\n');

      (generateWithAI as any).mockResolvedValue(wrappedJson);
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(channelAccount);
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(channelMetrics);
      (prismaMock.videoProject.findMany as any).mockResolvedValue(topVideos);

      const report = await auditService.runAudit({
        channelId: 'UC-audit-test-channel',
        expectedNiche: 'Technology',
      });

      expect(report.final_score).toBe(74);
      expect(report.niche_analysis.matchScore).toBe(85);
    });

    it('should handle partial AI response with missing fields in audit', async () => {
      const channelAccount = mockChannelAccount();
      const channelMetrics = mockChannelMetrics();
      const topVideos = Array.from({ length: 3 }, (_, i) => mockVideoProject(i + 1));

      // AI returns only partial data
      const partialReport = {
        final_score: 60,
        summary: 'Partial analysis',
        niche_analysis: {
          actualNiche: 'Tech',
          expectedNiche: 'Tech',
          matchScore: 80,
          mismatchReasons: [],
          nicheClarityLevel: 'Clear',
        },
      };

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partialReport));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(channelAccount);
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(channelMetrics);
      (prismaMock.videoProject.findMany as any).mockResolvedValue(topVideos);

      const report = await auditService.runAudit({
        channelId: 'UC-audit-test-channel',
      });

      // Missing fields should be filled with defaults
      expect(report.final_score).toBe(60);
      expect(report.niche_analysis.matchScore).toBe(80);
      expect(report.branding.brandingScore).toBe(50); // default
      expect(report.seo.seoScore).toBe(50); // default
      expect(report.content_strategy.contentStrategyScore).toBe(50); // default
      expect(report.ctr_retention.ctrScore).toBe(50); // default
    });
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 5: AI Degradation / Unavailable
  // ──────────────────────────────────────────────────────────
  describe('5. AI Service Degradation', () => {
    it('should return fallback report when AI service is completely unavailable (audit)', async () => {
      const channelAccount = mockChannelAccount();
      const channelMetrics = mockChannelMetrics();
      const topVideos = Array.from({ length: 3 }, (_, i) => mockVideoProject(i + 1));

      // generateWithAI returns the [AI_UNAVAILABLE] degradation message
      (generateWithAI as any).mockResolvedValue('[AI_UNAVAILABLE] All AI providers are currently unavailable.');
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(channelAccount);
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(channelMetrics);
      (prismaMock.videoProject.findMany as any).mockResolvedValue(topVideos);

      const report = await auditService.runAudit({
        channelId: 'UC-audit-test-channel',
      });

      expect(report.final_score).toBe(50);
      expect(report.summary).toContain('AI services are unavailable');
      expect(report.niche_analysis.actualNiche).toContain('unavailable');
      expect(report.action_plan.quick_fixes[0]).toContain('AI service');
    });

    it('should return fallback optimization when AI service is unavailable', async () => {
      (generateWithAI as any).mockResolvedValue('[AI_UNAVAILABLE] All AI providers are currently unavailable.');

      const result = await optimizerService.runOptimization({
        auditReport: MOCK_AUDIT_REPORT_JSON,
        channelName: 'TechExplained',
        channelDescription: '',
        channelTags: '',
        channelBanner: '',
        channelLogo: '',
        targetNiche: 'Technology',
        targetAudience: '',
      });

      expect(result.confidence_score).toBe(30);
      expect(result.transformation_summary).toContain('could not be completed');
    });
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 6: Score-Based Execution Mode
  // ──────────────────────────────────────────────────────────
  describe('6. Score-Based Execution Mode Boundaries', () => {
    it('should handle audit with score >= 70 (Optimized health status)', async () => {
      const highScoreReport = {
        ...MOCK_AUDIT_REPORT_JSON,
        final_score: 92,
        summary: 'Excellent channel performance across all metrics',
      };

      const channelAccount = mockChannelAccount();
      const channelMetrics = mockChannelMetrics({ avgCTR: 12.5, avgRetention: 68.0 });
      const topVideos = Array.from({ length: 10 }, (_, i) => mockVideoProject(i + 1, {
        analytics: { ...mockVideoProject(i + 1).analytics, ctr: 10 + i * 0.5, retention: 60 + i * 2 },
      }));

      (generateWithAI as any).mockResolvedValue(JSON.stringify(highScoreReport));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(channelAccount);
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(channelMetrics);
      (prismaMock.videoProject.findMany as any).mockResolvedValue(topVideos);

      const report = await auditService.runAudit({
        channelId: 'UC-audit-test-channel',
        expectedNiche: 'Technology',
      });

      expect(report.final_score).toBe(92);
    });

    it('should handle audit with score < 40 (Critical health status)', async () => {
      const lowScoreReport = {
        ...MOCK_AUDIT_REPORT_JSON,
        final_score: 23,
        summary: 'Channel needs critical improvements across all areas',
      };

      const channelAccount = mockChannelAccount({ niche: 'gaming' });
      const channelMetrics = mockChannelMetrics({ avgCTR: 2.1, avgRetention: 18.0, subscribers: 150 });
      const topVideos = Array.from({ length: 5 }, (_, i) => mockVideoProject(i + 1, {
        analytics: { ...mockVideoProject(i + 1).analytics, views: 200 - i * 20, ctr: 2.0 - i * 0.3, retention: 20 - i * 3 },
      }));

      (generateWithAI as any).mockResolvedValue(JSON.stringify(lowScoreReport));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(channelAccount);
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(channelMetrics);
      (prismaMock.videoProject.findMany as any).mockResolvedValue(topVideos);

      const report = await auditService.runAudit({
        channelId: 'UC-audit-test-channel',
      });

      expect(report.final_score).toBe(23);
    });

    it('should generate fine-tuning mode optimization for high-scored audit (score >= 60)', async () => {
      (generateWithAI as any).mockResolvedValue(JSON.stringify(MOCK_OPTIMIZATION_JSON));

      const result = await optimizerService.runOptimization({
        auditReport: { ...MOCK_AUDIT_REPORT_JSON, final_score: 82 },
        channelName: 'TechExplained',
        channelDescription: 'Great tech content',
        channelTags: 'tech',
        channelBanner: '',
        channelLogo: '',
        targetNiche: 'Technology',
        targetAudience: 'Tech enthusiasts',
      });

      expect(result).toBeDefined();
      expect(result.confidence_score).toBe(88);
    });

    it('should generate full rebrand optimization for low-scored audit (score < 25)', async () => {
      (generateWithAI as any).mockResolvedValue(JSON.stringify(MOCK_OPTIMIZATION_JSON));

      const result = await optimizerService.runOptimization({
        auditReport: { ...MOCK_AUDIT_REPORT_JSON, final_score: 18 },
        channelName: 'RandomVideos2024',
        channelDescription: 'Just random stuff',
        channelTags: 'random, fun',
        channelBanner: '',
        channelLogo: '',
        targetNiche: 'Gaming',
        targetAudience: 'Gamers',
      });

      expect(result).toBeDefined();
      expect(result.confidence_score).toBe(88);
    });
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 7: Advanced Scenario: Empty Channel
  // ──────────────────────────────────────────────────────────
  describe('7. Edge Cases — Empty / Minimal Channel', () => {
    it('should handle channel with no published videos', async () => {
      const channelAccount = mockChannelAccount({ channelTitle: 'BrandNewChannel' });
      const channelMetrics = mockChannelMetrics({
        subscribers: 0,
        totalViews: 0,
        totalVideos: 0,
        avgCTR: 0,
        avgRetention: 0,
      });

      (generateWithAI as any).mockResolvedValue(JSON.stringify(MOCK_AUDIT_REPORT_JSON));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(channelAccount);
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(channelMetrics);
      (prismaMock.videoProject.findMany as any).mockResolvedValue([]);

      const report = await auditService.runAudit({
        channelId: 'UC-audit-test-channel',
        expectedNiche: 'Technology',
      });

      expect(report).toBeDefined();
      expect(report.final_score).toBe(74);
      expect(prismaMock.videoProject.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 })
      );
    });
  });
});
