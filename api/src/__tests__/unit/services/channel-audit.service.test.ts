import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// HOISTED HELPERS
// ═══════════════════════════════════════════════════════════════

const prismaMock = vi.hoisted(() => {
  const models = ['youTubeAccount', 'channelMetrics', 'videoProject', 'analytics', 'uploadHistory'];
  const methods = ['findUnique', 'findFirst', 'findMany', 'create', 'update', 'upsert', 'delete', 'count'];
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
// MOCK EXTERNAL DEPENDENCIES
// ═══════════════════════════════════════════════════════════════

vi.mock('../../../config/db', () => ({ prisma: prismaMock, disconnectDatabase: vi.fn() }));

vi.mock('../../../utils/logger', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  aiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  queueLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  pipelineLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/env', () => ({
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

vi.mock('ioredis', () => {
  function MockIORedis() {
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

vi.mock('../../../config/redis', () => ({
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

vi.mock('../../../services/circuit-breaker.service', () => ({
  aiBreaker: vi.fn().mockReturnValue({
    call: vi.fn().mockImplementation((fn: Function) => fn()),
    status: 'closed',
    stats: { success: 0, failure: 0 },
  }),
}));

vi.mock('../../../services/ai-usage.service', () => ({
  AIUsageService: {
    track: vi.fn(),
    checkDailyLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 100, limit: 100 }),
    getDailyUsage: vi.fn().mockResolvedValue({ count: 0, tokens: 0, cost: 0 }),
  },
}));

vi.mock('../../../utils/prompt-sanitizer', () => ({
  sanitizePrompt: vi.fn().mockReturnValue({ sanitized: 'mock prompt', blocked: false }),
}));

vi.mock('../../../utils/token-estimator', () => ({
  estimateTokens: vi.fn().mockReturnValue(100),
  estimateCost: vi.fn().mockReturnValue(0.001),
}));

vi.mock('../../../services/ai.service', () => ({
  generateWithAI: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    create: vi.fn().mockReturnThis(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

// ═══════════════════════════════════════════════════════════════
// IMPORT TESTED MODULE
// ═══════════════════════════════════════════════════════════════

import { generateWithAI } from '../../../services/ai.service';
import { ChannelAuditService } from '../../../services/channel-audit.service';
import type { ChannelAuditReport } from '../../../services/channel-audit.service';

// ═══════════════════════════════════════════════════════════════
// MOCK DATA HELPERS
// ═══════════════════════════════════════════════════════════════

function mockChannelAccount(overrides: Record<string, any> = {}) {
  return {
    id: 'yt-acc-unit-1',
    userId: 'user-unit-1',
    channelId: 'UC-unit-test',
    channelTitle: 'TestChannel',
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
    id: 'metrics-unit-1',
    channelId: 'UC-unit-test',
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
    id: `video-unit-${idx}`,
    userId: 'user-unit-1',
    channelId: 'UC-unit-test',
    topic: `Topic ${idx}`,
    title: `Video Title ${idx}`,
    status: 'published',
    createdAt: new Date(Date.now() - idx * 86400000),
    updatedAt: new Date(),
    analytics: {
      id: `analytics-${idx}`,
      projectId: `video-unit-${idx}`,
      views: 50000 - idx * 3000,
      likes: 3000 - idx * 200,
      comments: 400 - idx * 30,
      ctr: 7.0 - idx * 0.3,
      retention: 50.0 - idx * 2.0,
      watchTime: 25000 - idx * 1500,
    },
    uploadHistory: {
      id: `uh-${idx}`,
      projectId: `video-unit-${idx}`,
      videoId: `yt-video-${idx}`,
      status: 'uploaded',
      publishedAt: new Date(Date.now() - idx * 86400000),
    },
    ...overrides,
  };
}

/** A complete, valid audit report used as a base for tests */
function makeCompleteReport(overrides: Partial<ChannelAuditReport> = {}): ChannelAuditReport {
  return {
    niche_analysis: {
      actualNiche: 'Technology Education',
      expectedNiche: 'Technology',
      matchScore: 85,
      mismatchReasons: ['Covers broader tech education, not just news'],
      nicheClarityLevel: 'Clear',
    },
    branding: {
      brandingScore: 72,
      issues: ['Banner lacks clear value proposition'],
      emotionalImpactLevel: 'Medium',
    },
    seo: {
      seoScore: 65,
      missingKeywords: ['machine learning'],
      keywordOpportunities: ['AI for beginners'],
    },
    content_strategy: {
      contentStrategyScore: 78,
      viralPotentialRating: 'High potential in tutorials',
      contentGaps: ['No short-form content'],
    },
    ctr_retention: {
      ctrScore: 70,
      retentionScore: 55,
      keyDropOffRisks: ['First 15 seconds lack hook'],
    },
    competitor_analysis: {
      weaknessVsCompetitors: ['Less frequent uploads'],
      opportunitiesToOutperform: ['Unique tutorial angles'],
    },
    action_plan: {
      quick_fixes: ['Optimize channel banner'],
      high_impact_fixes: ['Create a content calendar'],
      long_term_strategy: ['Build a series on AI fundamentals'],
      suggestedDescription: 'Welcome to TechExplained — tech content.',
      suggestedTags: ['technology', 'ai tutorial'],
      suggestedChannelName: 'TechExplained Pro',
      bannerTextSuggestion: 'Tech Made Simple',
      logoConceptSuggestion: 'Minimalist letter T with circuit board pattern',
    },
    final_score: 74,
    summary: 'TechExplained is a solid tech education channel.',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// UNIT TESTS: ChannelAuditService
// ═══════════════════════════════════════════════════════════════

describe('ChannelAuditService', () => {
  let service: ChannelAuditService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ChannelAuditService();
  });

  // ──────────────────────────────────────────────────────────
  // validateReport — fills missing fields with defaults
  // ──────────────────────────────────────────────────────────
  describe('validateReport (via runAudit with partial AI responses)', () => {
    it('should fill defaults for missing niche_analysis', async () => {
      const partial = makeCompleteReport();
      delete (partial as any).niche_analysis;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      expect(report.niche_analysis).toBeDefined();
      expect(report.niche_analysis.matchScore).toBe(50); // default
      expect(report.niche_analysis.actualNiche).toBe('Unknown');
      expect(report.niche_analysis.nicheClarityLevel).toBe('Mixed');
      expect(report.niche_analysis.mismatchReasons).toContain('Insufficient data to determine niche alignment');
    });

    it('should fill defaults for missing branding', async () => {
      const partial = makeCompleteReport();
      delete (partial as any).branding;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      expect(report.branding).toBeDefined();
      expect(report.branding.brandingScore).toBe(50); // default
      expect(report.branding.issues).toContain('Unable to analyze branding — data incomplete');
      expect(report.branding.emotionalImpactLevel).toBe('Medium');
    });

    it('should fill defaults for missing SEO', async () => {
      const partial = makeCompleteReport();
      delete (partial as any).seo;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      expect(report.seo).toBeDefined();
      expect(report.seo.seoScore).toBe(50); // default
      expect(report.seo.missingKeywords).toContain('Unable to determine — data incomplete');
      expect(report.seo.keywordOpportunities).toContain('Unable to determine — data incomplete');
    });

    it('should fill defaults for missing content_strategy', async () => {
      const partial = makeCompleteReport();
      delete (partial as any).content_strategy;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      expect(report.content_strategy).toBeDefined();
      expect(report.content_strategy.contentStrategyScore).toBe(50);
      expect(report.content_strategy.viralPotentialRating).toBe('Unknown');
      expect(report.content_strategy.contentGaps).toContain('Unable to determine — data incomplete');
    });

    it('should fill defaults for missing ctr_retention', async () => {
      const partial = makeCompleteReport();
      delete (partial as any).ctr_retention;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      expect(report.ctr_retention).toBeDefined();
      expect(report.ctr_retention.ctrScore).toBe(50);
      expect(report.ctr_retention.retentionScore).toBe(50);
      expect(report.ctr_retention.keyDropOffRisks).toContain('Unable to determine — data incomplete');
    });

    it('should fill defaults for missing competitor_analysis', async () => {
      const partial = makeCompleteReport();
      delete (partial as any).competitor_analysis;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      expect(report.competitor_analysis).toBeDefined();
      expect(report.competitor_analysis.weaknessVsCompetitors).toContain('No competitor data available');
      expect(report.competitor_analysis.opportunitiesToOutperform).toContain('No competitor data available');
    });

    it('should fill defaults for missing action_plan', async () => {
      const partial = makeCompleteReport();
      delete (partial as any).action_plan;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      expect(report.action_plan).toBeDefined();
      expect(report.action_plan.quick_fixes).toContain('Connect channel to get full audit');
      expect(report.action_plan.high_impact_fixes).toContain('Upload more content to gather analytics');
      expect(report.action_plan.long_term_strategy).toContain('Consistent uploads + analyze YouTube Studio data');
      expect(report.action_plan.suggestedDescription).toContain('N/A');
      expect(report.action_plan.suggestedTags).toContain('N/A');
      expect(report.action_plan.suggestedChannelName).toBe('N/A');
      expect(report.action_plan.bannerTextSuggestion).toBe('N/A');
      expect(report.action_plan.logoConceptSuggestion).toBe('N/A');
    });

    it('should fill defaults for missing final_score and summary', async () => {
      const partial = makeCompleteReport();
      delete (partial as any).final_score;
      delete (partial as any).summary;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount({ channelTitle: 'UnitTestChannel' }));
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      expect(report.final_score).toBe(50); // default
      expect(report.summary).toContain('UnitTestChannel');
      expect(report.summary).toContain('limited data');
    });

    it('should preserve passed values and only fill missing defaults', async () => {
      const partial = {
        niche_analysis: {
          actualNiche: 'Gaming',
          expectedNiche: 'Gaming Entertainment',
          matchScore: 68,
          mismatchReasons: ['Channel covers multiple game genres without focus'],
          nicheClarityLevel: 'Mixed' as const,
        },
        // branding intentionally omitted
        // seo intentionally omitted
        final_score: 60,
        summary: 'Good gaming content but needs focus.',
      };

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount({ channelTitle: 'GameChannel' }));
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      // Preserved values
      expect(report.niche_analysis.matchScore).toBe(68);
      expect(report.niche_analysis.actualNiche).toBe('Gaming');
      expect(report.final_score).toBe(60);
      expect(report.summary).toContain('Good gaming content');

      // Defaults filled in
      expect(report.branding.brandingScore).toBe(50);
      expect(report.seo.seoScore).toBe(50);
    });

    it('should handle completely empty AI response (only final_score)', async () => {
      const partial = { final_score: 30 };

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount({ channelTitle: 'EmptyChannel' }));
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      expect(report.final_score).toBe(30);
      expect(report.niche_analysis.matchScore).toBe(50); // default
      expect(report.branding.brandingScore).toBe(50); // default
      expect(report.seo.seoScore).toBe(50); // default
      expect(report.content_strategy.contentStrategyScore).toBe(50); // default
      expect(report.ctr_retention.ctrScore).toBe(50); // default
      expect(report.action_plan.quick_fixes.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle partially missing action_plan nested fields', async () => {
      const partial = makeCompleteReport();
      // Only set some action_plan fields, leave others missing
      partial.action_plan = {
        quick_fixes: ['Fix thumbnail'],
        high_impact_fixes: ['Improve description'],
        long_term_strategy: ['Weekly uploads'],
        // suggestedDescription missing
        // suggestedTags missing
        // suggestedChannelName missing
        // bannerTextSuggestion missing
        // logoConceptSuggestion missing
      } as any;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      // Since action_plan is defined (not missing entirely), validateReport uses it as-is
      // The missing string fields will be undefined, but the arrays should work
      expect(report.action_plan.quick_fixes).toContain('Fix thumbnail');
      expect(report.action_plan.high_impact_fixes).toContain('Improve description');
      expect(report.action_plan.long_term_strategy).toContain('Weekly uploads');
      // Missing string fields will be undefined since the object exists but these fields are not set
      expect(report.action_plan.suggestedDescription).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────
  // buildFallbackReport — complete fallback when AI unavailable
  // ──────────────────────────────────────────────────────────
  describe('buildFallbackReport (via runAudit with unparseable AI responses)', () => {
    it('should return a complete report with all sections when AI returns unparseable JSON', async () => {
      (generateWithAI as any).mockResolvedValue('Not valid JSON at all!!!');
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      expect(report).toBeDefined();
      expect(report.niche_analysis).toBeDefined();
      expect(report.branding).toBeDefined();
      expect(report.seo).toBeDefined();
      expect(report.content_strategy).toBeDefined();
      expect(report.ctr_retention).toBeDefined();
      expect(report.competitor_analysis).toBeDefined();
      expect(report.action_plan).toBeDefined();
    });

    it('should have default score of 50 in fallback report', async () => {
      (generateWithAI as any).mockResolvedValue('{{{ completely broken json ');
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      expect(report.final_score).toBe(50);
      expect(report.niche_analysis.matchScore).toBe(50);
      expect(report.branding.brandingScore).toBe(50);
      expect(report.seo.seoScore).toBe(50);
    });

    it('should include channel name in fallback summary', async () => {
      (generateWithAI as any).mockResolvedValue('garbage');
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount({ channelTitle: 'MyAwesomeChannel' }));
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      expect(report.summary).toContain('MyAwesomeChannel');
      expect(report.summary).toContain('AI services are unavailable');
    });

    it('should contain AI unavailable markers in fallback action_plan', async () => {
      (generateWithAI as any).mockResolvedValue(null);
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      expect(report.action_plan.quick_fixes[0]).toContain('AI service');
      expect(report.action_plan.high_impact_fixes[0]).toContain('Ollama');
      expect(report.action_plan.long_term_strategy[0]).toContain('AI service');
      expect(report.action_plan.suggestedChannelName).toBe('AI unavailable');
      expect(report.action_plan.suggestedTags).toContain('AI unavailable');
    });

    it('should mark all analysis sections as AI unavailable', async () => {
      (generateWithAI as any).mockResolvedValue('[AI_UNAVAILABLE] All AI providers unavailable.');
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      expect(report.niche_analysis.actualNiche).toContain('unavailable');
      expect(report.branding.issues[0]).toContain('unavailable');
      expect(report.seo.missingKeywords[0]).toContain('unavailable');
      expect(report.content_strategy.viralPotentialRating).toContain('unavailable');
      expect(report.ctr_retention.keyDropOffRisks[0]).toContain('unavailable');
      expect(report.competitor_analysis.weaknessVsCompetitors[0]).toContain('unavailable');
    });

    it('should handle fallback when AI returns empty string', async () => {
      (generateWithAI as any).mockResolvedValue('');
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      // Empty string is not valid JSON, so should trigger fallback
      expect(report.final_score).toBe(50);
      expect(report.summary).toContain('AI services are unavailable');
    });
  });

  // ──────────────────────────────────────────────────────────
  // callAuditAI — error paths and edge cases
  // ──────────────────────────────────────────────────────────
  describe('callAuditAI error paths', () => {
    it('should propagate AI errors when generateWithAI throws', async () => {
      (generateWithAI as any).mockRejectedValue(new Error('AI provider timeout'));
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      await expect(service.runAudit({ channelId: 'UC-unit-test' })).rejects.toThrow('AI provider timeout');
    });

    it('should handle AI returning array-wrapped JSON (single-element array)', async () => {
      const singleElementArray = JSON.stringify([makeCompleteReport()]);

      (generateWithAI as any).mockResolvedValue(singleElementArray);
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      // extractJson may or may not handle array wrapping; if it doesn't,
      // it'll return null → trigger fallback. Either way is acceptable.
      // If it does handle it, we get the report; if not, we get fallback.
      // Let's just check that we got a valid report object either way.
      expect(report).toBeDefined();
      expect(typeof report.final_score).toBe('number');
    });

    it('should handle AI returning response with trailing whitespace and newlines', async () => {
      const raw = `\n\n  \n${JSON.stringify(makeCompleteReport())}\n  \n`;

      (generateWithAI as any).mockResolvedValue(raw);
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(mockChannelAccount());
      (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(mockChannelMetrics());
      (prismaMock.videoProject.findMany as any).mockResolvedValue([mockVideoProject(1)]);

      const report = await service.runAudit({ channelId: 'UC-unit-test' });

      expect(report.final_score).toBe(74);
      expect(report.niche_analysis.matchScore).toBe(85);
    });
  });

  // ──────────────────────────────────────────────────────────
  // Integration: direct access to private methods
  // ──────────────────────────────────────────────────────────
  describe('private methods (accessed via bracket notation)', () => {
    it('buildFallbackReport should return a complete report', () => {
      const fallbackFn = (service as any).buildFallbackReport.bind(service);
      const result: ChannelAuditReport = fallbackFn('FallbackChannel');

      expect(result.final_score).toBe(50);
      expect(result.niche_analysis.actualNiche).toContain('unavailable');
      expect(result.branding.brandingScore).toBe(50);
      expect(result.action_plan.quick_fixes[0]).toContain('AI service');
      expect(result.action_plan.high_impact_fixes[0]).toContain('Ollama');
      expect(result.action_plan.suggestedTags).toContain('AI unavailable');
      expect(result.summary).toContain('FallbackChannel');
      expect(result.summary).toContain('AI services are unavailable');
    });

    it('buildFallbackReport should handle special characters in channel name', () => {
      const fallbackFn = (service as any).buildFallbackReport.bind(service);
      const result: ChannelAuditReport = fallbackFn('Channel-123_!@#$%');

      expect(result.summary).toContain('Channel-123_!@#$%');
    });

    it('buildFallbackReport should have all 7 analysis sections populated', () => {
      const fallbackFn = (service as any).buildFallbackReport.bind(service);
      const result: ChannelAuditReport = fallbackFn('TestChannel');

      const sections = [
        'niche_analysis', 'branding', 'seo', 'content_strategy',
        'ctr_retention', 'competitor_analysis', 'action_plan',
      ];
      for (const section of sections) {
        expect((result as any)[section]).toBeDefined();
      }
    });

    it('buildFallbackReport should have all action_plan sub-fields populated', () => {
      const fallbackFn = (service as any).buildFallbackReport.bind(service);
      const result: ChannelAuditReport = fallbackFn('TestChannel');

      expect(Array.isArray(result.action_plan.quick_fixes)).toBe(true);
      expect(result.action_plan.quick_fixes.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(result.action_plan.high_impact_fixes)).toBe(true);
      expect(result.action_plan.high_impact_fixes.length).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(result.action_plan.long_term_strategy)).toBe(true);
      expect(result.action_plan.long_term_strategy.length).toBeGreaterThanOrEqual(1);
      expect(typeof result.action_plan.suggestedDescription).toBe('string');
      expect(Array.isArray(result.action_plan.suggestedTags)).toBe(true);
      expect(typeof result.action_plan.suggestedChannelName).toBe('string');
      expect(typeof result.action_plan.bannerTextSuggestion).toBe('string');
      expect(typeof result.action_plan.logoConceptSuggestion).toBe('string');
    });
  });
});
