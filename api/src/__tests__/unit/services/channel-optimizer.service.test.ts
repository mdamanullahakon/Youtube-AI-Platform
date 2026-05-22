import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// MOCK EXTERNAL DEPENDENCIES
// ═══════════════════════════════════════════════════════════════
// The optimizer only needs: generateWithAI, logger, env, redis,
// and AI service internals (circuit-breaker, ai-usage, etc.)

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
    GEMINI_API_KEY: '',
    OLLAMA_HOST: 'http://localhost:11434',
    OLLAMA_MODEL: 'llama3',
    YOUTUBE_CLIENT_ID: 'mock-client-id',
    YOUTUBE_CLIENT_SECRET: 'mock-client-secret',
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
import { ChannelOptimizerService } from '../../../services/channel-optimizer.service';
import type { ChannelAuditReport } from '../../../services/channel-audit.service';
import type { OptimizationOutput } from '../../../services/channel-optimizer.service';

// ═══════════════════════════════════════════════════════════════
// MOCK DATA HELPERS
// ═══════════════════════════════════════════════════════════════

/** A complete audit report used as input for optimization tests */
function makeAuditReport(overrides: Partial<ChannelAuditReport> = {}): ChannelAuditReport {
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
      suggestedDescription: 'Welcome to TechExplained.',
      suggestedTags: ['technology', 'ai tutorial'],
      suggestedChannelName: 'TechExplained Pro',
      bannerTextSuggestion: 'Tech Made Simple',
      logoConceptSuggestion: 'Minimalist letter T design',
    },
    final_score: 74,
    summary: 'Solid tech education channel.',
    ...overrides,
  };
}

/** A complete, valid optimization output for base assertions */
function makeCompleteOutput(overrides: Partial<OptimizationOutput> = {}): OptimizationOutput {
  return {
    niche_positioning: 'TechExplained — most accessible AI and coding education.',
    optimized_description: 'STOP scrolling and START learning. TechExplained breaks down AI and coding into simple lessons.',
    optimized_tags: ['technology', 'ai tutorial', 'machine learning', 'coding tips', 'programming'],
    name_suggestions: ['TechExplained Pro', 'TechSimple', 'ByteWise'],
    banner_text: { headline: 'Tech Made Simple', subheadline: 'AI • Coding • Reviews — Weekly' },
    logo_concept: 'Minimalist letter T with circuit board traces, gradient blue-to-purple.',
    viral_video_ideas: [
      'I Used AI to Code an App in 10 Minutes',
      'The AI Tool That Replaces 10 Engineers',
      'This Simple Python Script Made Me $500/Month',
    ],
    seo_boost: {
      keywordsToTarget: ['AI tutorial for beginners', 'how to learn coding 2026'],
      hashtagStrategy: 'Use 3 high-volume tags + 2 niche tags per video.',
    },
    monetization_plan: '1) Affiliate marketing: Promote coding courses. 2) Sponsorships: Target dev tool companies.',
    transformation_summary: 'Complete channel overhaul applied.',
    confidence_score: 88,
    before_vs_after: {
      whatWasWrong: ['Channel description was generic'],
      whatIsFixed: ['SEO-optimized description with keywords'],
      expectedImprovement: 'Estimated 40-60% improvement in CTR.',
    },
    ...overrides,
  };
}

/** Build a standard optimizer input object */
function makeOptimizerInput(overrides: Partial<{
  auditReport: ChannelAuditReport;
  channelName: string;
  channelDescription: string;
  channelTags: string;
  channelBanner: string;
  channelLogo: string;
  targetNiche: string;
  targetAudience: string;
  competitorInsights: string;
}> = {}): {
  auditReport: ChannelAuditReport;
  channelName: string;
  channelDescription: string;
  channelTags: string;
  channelBanner: string;
  channelLogo: string;
  targetNiche: string;
  targetAudience: string;
  competitorInsights?: string;
} {
  return {
    auditReport: makeAuditReport(),
    channelName: 'TechExplained',
    channelDescription: 'Tech reviews and tutorials for everyone',
    channelTags: 'tech, coding, ai',
    channelBanner: 'https://yt3.googleusercontent.com/banner',
    channelLogo: 'https://yt3.googleusercontent.com/logo',
    targetNiche: 'Technology Education',
    targetAudience: 'Tech enthusiasts and beginners learning to code',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// UNIT TESTS: ChannelOptimizerService
// ═══════════════════════════════════════════════════════════════

describe('ChannelOptimizerService', () => {
  let service: ChannelOptimizerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ChannelOptimizerService();
  });

  // ──────────────────────────────────────────────────────────
  // determineMode — score-based execution mode
  // ──────────────────────────────────────────────────────────
  describe('determineMode (score boundaries)', () => {
    it('should return FULL_REBRAND for score < 25', () => {
      const mode = (service as any).determineMode(0);
      expect(mode).toBe('FULL_REBRAND');

      expect((service as any).determineMode(24)).toBe('FULL_REBRAND');
      expect((service as any).determineMode(1)).toBe('FULL_REBRAND');
    });

    it('should return PARTIAL_REBRAND for score 25-39', () => {
      expect((service as any).determineMode(25)).toBe('PARTIAL_REBRAND');
      expect((service as any).determineMode(30)).toBe('PARTIAL_REBRAND');
      expect((service as any).determineMode(39)).toBe('PARTIAL_REBRAND');
    });

    it('should return AGGRESSIVE_OPTIMIZATION for score 40-59', () => {
      expect((service as any).determineMode(40)).toBe('AGGRESSIVE_OPTIMIZATION');
      expect((service as any).determineMode(50)).toBe('AGGRESSIVE_OPTIMIZATION');
      expect((service as any).determineMode(59)).toBe('AGGRESSIVE_OPTIMIZATION');
    });

    it('should return FINE_TUNING for score >= 60', () => {
      expect((service as any).determineMode(60)).toBe('FINE_TUNING');
      expect((service as any).determineMode(85)).toBe('FINE_TUNING');
      expect((service as any).determineMode(100)).toBe('FINE_TUNING');
    });

    it('should respect exact boundary values (24, 25, 39, 40, 59, 60)', () => {
      expect((service as any).determineMode(24)).toBe('FULL_REBRAND');
      expect((service as any).determineMode(25)).toBe('PARTIAL_REBRAND');
      expect((service as any).determineMode(39)).toBe('PARTIAL_REBRAND');
      expect((service as any).determineMode(40)).toBe('AGGRESSIVE_OPTIMIZATION');
      expect((service as any).determineMode(59)).toBe('AGGRESSIVE_OPTIMIZATION');
      expect((service as any).determineMode(60)).toBe('FINE_TUNING');
    });
  });

  // ──────────────────────────────────────────────────────────
  // validateOutput — fills missing fields with defaults
  // ──────────────────────────────────────────────────────────
  describe('validateOutput (via runOptimization with partial AI responses)', () => {
    it('should fill defaults for missing niche_positioning', async () => {
      const partial = makeCompleteOutput();
      delete (partial as any).niche_positioning;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.niche_positioning).toContain('Optimized positioning for');
      expect(result.niche_positioning).toContain('TechExplained');
    });

    it('should fill defaults for missing optimized_description', async () => {
      const partial = makeCompleteOutput();
      delete (partial as any).optimized_description;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.optimized_description).toContain('TechExplained');
      expect(result.optimized_description).toContain('Subscribe');
    });

    it('should fill defaults for missing optimized_tags', async () => {
      const partial = makeCompleteOutput();
      delete (partial as any).optimized_tags;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.optimized_tags).toContain('TechExplained');
      expect(result.optimized_tags.length).toBeGreaterThanOrEqual(1);
    });

    it('should fill defaults for empty optimized_tags array', async () => {
      const partial = makeCompleteOutput({ optimized_tags: [] });

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.optimized_tags).toContain('TechExplained');
    });

    it('should fill defaults for missing name_suggestions', async () => {
      const partial = makeCompleteOutput();
      delete (partial as any).name_suggestions;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.name_suggestions).toContain('TechExplained');
    });

    it('should fill defaults for missing banner_text', async () => {
      const partial = makeCompleteOutput();
      delete (partial as any).banner_text;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.banner_text.headline).toBe('');
      expect(result.banner_text.subheadline).toBe('');
    });

    it('should fill defaults for missing logo_concept', async () => {
      const partial = makeCompleteOutput();
      delete (partial as any).logo_concept;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.logo_concept).toContain('Minimalist');
      expect(result.logo_concept).toContain('bold colors');
    });

    it('should fill defaults for missing viral_video_ideas', async () => {
      const partial = makeCompleteOutput();
      delete (partial as any).viral_video_ideas;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.viral_video_ideas[0]).toContain('Analyze top-performing');
    });

    it('should fill defaults for missing seo_boost', async () => {
      const partial = makeCompleteOutput();
      delete (partial as any).seo_boost;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.seo_boost.keywordsToTarget).toEqual([]);
      expect(result.seo_boost.hashtagStrategy).toBe('');
    });

    it('should fill defaults for missing monetization_plan', async () => {
      const partial = makeCompleteOutput();
      delete (partial as any).monetization_plan;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.monetization_plan).toContain('pending full channel audit');
    });

    it('should fill defaults for missing transformation_summary', async () => {
      const partial = makeCompleteOutput();
      delete (partial as any).transformation_summary;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.transformation_summary).toContain('Optimization applied to');
      expect(result.transformation_summary).toContain('TechExplained');
    });

    it('should fill defaults for missing confidence_score', async () => {
      const partial = makeCompleteOutput();
      delete (partial as any).confidence_score;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.confidence_score).toBe(50); // default
    });

    it('should fill defaults for missing before_vs_after', async () => {
      const partial = makeCompleteOutput();
      delete (partial as any).before_vs_after;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.before_vs_after.whatWasWrong).toContain('Limited data available');
      expect(result.before_vs_after.whatIsFixed).toContain('Optimization queued');
      expect(result.before_vs_after.expectedImprovement).toContain('Improvement data will be available');
    });

    it('should preserve passed values and only fill missing defaults', async () => {
      const partial = {
        niche_positioning: 'Custom positioning statement',
        optimized_description: 'Custom optimized description with SEO keywords and CTA',
        optimized_tags: ['tag1', 'tag2'],
        name_suggestions: ['NameA'],
        banner_text: { headline: 'Custom Headline', subheadline: 'Custom Sub' },
        logo_concept: 'Custom logo design concept',
        viral_video_ideas: ['Custom video idea 1', 'Custom video idea 2'],
        // seo_boost intentionally omitted
        monetization_plan: 'Custom monetization strategy',
        transformation_summary: 'Custom transformation summary',
        confidence_score: 92,
        // before_vs_after intentionally omitted
      } as any;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));

      const result = await service.runOptimization(makeOptimizerInput());

      // Preserved values
      expect(result.niche_positioning).toBe('Custom positioning statement');
      expect(result.optimized_description).toBe('Custom optimized description with SEO keywords and CTA');
      expect(result.optimized_tags).toEqual(['tag1', 'tag2']);
      expect(result.name_suggestions).toEqual(['NameA']);
      expect(result.banner_text.headline).toBe('Custom Headline');
      expect(result.logo_concept).toBe('Custom logo design concept');
      expect(result.viral_video_ideas).toEqual(['Custom video idea 1', 'Custom video idea 2']);
      expect(result.monetization_plan).toBe('Custom monetization strategy');
      expect(result.transformation_summary).toBe('Custom transformation summary');
      expect(result.confidence_score).toBe(92);

      // Defaults filled in for omitted fields
      expect(result.seo_boost.keywordsToTarget).toEqual([]);
      expect(result.seo_boost.hashtagStrategy).toBe('');
      expect(result.before_vs_after.whatWasWrong).toContain('Limited data available');
    });

    it('should handle completely empty AI response (only confidence_score)', async () => {
      const partial = { confidence_score: 15 };

      (generateWithAI as any).mockResolvedValue(JSON.stringify(partial));

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.confidence_score).toBe(15);
      expect(result.niche_positioning).toContain('Optimized positioning');
      expect(result.optimized_tags).toContain('TechExplained');
      expect(result.name_suggestions).toContain('TechExplained');
      expect(result.banner_text.headline).toBe('');
      expect(result.logo_concept).toContain('Minimalist');
      expect(result.viral_video_ideas[0]).toContain('Analyze top-performing');
      expect(result.seo_boost.keywordsToTarget).toEqual([]);
      expect(result.monetization_plan).toContain('pending');
      expect(result.before_vs_after.whatWasWrong).toContain('Limited data available');
    });
  });

  // ──────────────────────────────────────────────────────────
  // buildFallbackOutput — complete fallback when AI unavailable
  // ──────────────────────────────────────────────────────────
  describe('buildFallbackOutput (via runOptimization with unparseable AI responses)', () => {
    it('should return a complete output with all fields when AI returns unparseable JSON', async () => {
      (generateWithAI as any).mockResolvedValue('Not valid JSON at all!!!');

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result).toBeDefined();
      expect(result.niche_positioning).toBeTruthy();
      expect(result.optimized_description).toBeTruthy();
      expect(result.optimized_tags.length).toBeGreaterThanOrEqual(1);
      expect(result.name_suggestions.length).toBeGreaterThanOrEqual(1);
      expect(result.banner_text.headline).toBeTruthy();
      expect(result.logo_concept).toBeTruthy();
      expect(result.viral_video_ideas.length).toBeGreaterThanOrEqual(1);
      expect(result.seo_boost).toBeDefined();
      expect(result.monetization_plan).toBeTruthy();
      expect(result.transformation_summary).toBeTruthy();
      expect(result.before_vs_after).toBeDefined();
    });

    it('should have default confidence_score of 30 in fallback', async () => {
      (generateWithAI as any).mockResolvedValue('{{{ completely broken json ');

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.confidence_score).toBe(30);
    });

    it('should include channel name and mode in fallback transformation_summary', async () => {
      (generateWithAI as any).mockResolvedValue('garbage');

      const result = await service.runOptimization(makeOptimizerInput({
        channelName: 'MyChannel',
        auditReport: makeAuditReport({ final_score: 45 }),
      }));

      expect(result.transformation_summary).toContain('MyChannel');
      expect(result.transformation_summary).toContain('AGGRESSIVE_OPTIMIZATION');
      expect(result.transformation_summary).toContain('could not be completed');
    });

    it('should have AI-unavailable markers in viral_video_ideas and seo_boost', async () => {
      (generateWithAI as any).mockResolvedValue('[AI_UNAVAILABLE] All AI providers unavailable.');

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.viral_video_ideas[0]).toContain('AI unavailable');
      expect(result.seo_boost.hashtagStrategy).toContain('AI unavailable');
      expect(result.monetization_plan).toContain('AI unavailable');
      expect(result.logo_concept).toContain('AI unavailable');
      expect(result.niche_positioning).toContain('AI unavailable');
    });

    it('should handle fallback when AI returns empty string', async () => {
      (generateWithAI as any).mockResolvedValue('');

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.confidence_score).toBe(30);
      expect(result.transformation_summary).toContain('could not be completed');
    });

    it('should include channel name in fallback niche_positioning and description', async () => {
      (generateWithAI as any).mockResolvedValue(null);

      const result = await service.runOptimization(makeOptimizerInput({
        channelName: 'MyAwesomeTechChannel',
      }));

      expect(result.niche_positioning).toContain('MyAwesomeTechChannel');
      expect(result.optimized_description).toContain('MyAwesomeTechChannel');
      expect(result.optimized_tags).toContain('myawesometechchannel');
    });
  });

  // ──────────────────────────────────────────────────────────
  // runOptimization — error paths and edge cases
  // ──────────────────────────────────────────────────────────
  describe('runOptimization error paths', () => {
    it('should propagate AI errors when generateWithAI throws', async () => {
      (generateWithAI as any).mockRejectedValue(new Error('Optimizer AI provider timeout'));

      await expect(service.runOptimization(makeOptimizerInput())).rejects.toThrow('Optimizer AI provider timeout');
    });

    it('should handle AI returning markdown-wrapped JSON', async () => {
      const wrappedJson = [
        '```json',
        JSON.stringify(makeCompleteOutput()),
        '```',
      ].join('\n');

      (generateWithAI as any).mockResolvedValue(wrappedJson);

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.confidence_score).toBe(88);
      expect(result.niche_positioning).toContain('TechExplained');
    });

    it('should handle AI returning response with trailing whitespace and newlines', async () => {
      const raw = `\n\n  \n${JSON.stringify(makeCompleteOutput())}\n  \n`;

      (generateWithAI as any).mockResolvedValue(raw);

      const result = await service.runOptimization(makeOptimizerInput());

      expect(result.confidence_score).toBe(88);
      expect(result.optimized_tags).toContain('technology');
    });

    it('should handle competitorInsights being undefined', async () => {
      const input = makeOptimizerInput();
      // competitorInsights is optional and omitted from the default
      delete (input as any).competitorInsights;

      (generateWithAI as any).mockResolvedValue(JSON.stringify(makeCompleteOutput()));

      const result = await service.runOptimization(input);

      expect(result.confidence_score).toBe(88);
    });

    it('should handle minimal input with only required fields', async () => {
      (generateWithAI as any).mockResolvedValue(JSON.stringify(makeCompleteOutput()));

      const result = await service.runOptimization({
        auditReport: makeAuditReport(),
        channelName: 'MinimalChannel',
        channelDescription: '',
        channelTags: '',
        channelBanner: '',
        channelLogo: '',
        targetNiche: 'Gaming',
        targetAudience: '',
      });

      expect(result.confidence_score).toBe(88);
      expect(result.niche_positioning).toBeTruthy();
    });

    it('should use correct mode based on audit report score in the prompt', async () => {
      // Test with a low score — the mode AGGRESSIVE_OPTIMIZATION should appear
      (generateWithAI as any).mockImplementation((prompt: string, provider: string, opts: any) => {
        // Verify the prompt includes the correct mode
        expect(prompt).toContain('AGGRESSIVE_OPTIMIZATION');
        return JSON.stringify(makeCompleteOutput());
      });

      await service.runOptimization(makeOptimizerInput({
        auditReport: makeAuditReport({ final_score: 45 }),
      }));

      expect(generateWithAI).toHaveBeenCalledTimes(1);
    });

    it('should use FULL_REBRAND mode for score < 25', async () => {
      let capturedPrompt = '';
      (generateWithAI as any).mockImplementation((prompt: string) => {
        capturedPrompt = prompt;
        return JSON.stringify(makeCompleteOutput());
      });

      await service.runOptimization(makeOptimizerInput({
        auditReport: makeAuditReport({ final_score: 12 }),
      }));

      expect(capturedPrompt).toContain('FULL_REBRAND');
      expect(capturedPrompt).toContain('Full rebranding mode activated');
    });

    it('should use FINE_TUNING mode for score >= 60', async () => {
      let capturedPrompt = '';
      (generateWithAI as any).mockImplementation((prompt: string) => {
        capturedPrompt = prompt;
        return JSON.stringify(makeCompleteOutput());
      });

      await service.runOptimization(makeOptimizerInput({
        auditReport: makeAuditReport({ final_score: 88 }),
      }));

      expect(capturedPrompt).toContain('FINE_TUNING');
      expect(capturedPrompt).toContain('Fine-tuning mode');
    });
  });

  // ──────────────────────────────────────────────────────────
  // Direct access to private methods
  // ──────────────────────────────────────────────────────────
  describe('private methods (accessed via bracket notation)', () => {
    it('buildFallbackOutput should return a complete output with all fields populated', () => {
      const fallbackFn = (service as any).buildFallbackOutput.bind(service);
      const result: OptimizationOutput = fallbackFn('TestChannel', 'FINE_TUNING');

      expect(result.confidence_score).toBe(30);
      expect(result.niche_positioning).toContain('TestChannel');
      expect(result.optimized_description).toContain('TestChannel');
      expect(result.name_suggestions).toContain('TestChannel');
      expect(result.banner_text.headline).toBe('Coming Soon');
      expect(Array.isArray(result.viral_video_ideas)).toBe(true);
      expect(Array.isArray(result.seo_boost.keywordsToTarget)).toBe(true);
      expect(typeof result.seo_boost.hashtagStrategy).toBe('string');
      expect(typeof result.monetization_plan).toBe('string');
      expect(result.before_vs_after.whatWasWrong[0]).toContain('AI service unavailable');
    });

    it('buildFallbackOutput should handle special characters in channel name', () => {
      const fallbackFn = (service as any).buildFallbackOutput.bind(service);
      const result: OptimizationOutput = fallbackFn('Channel-123_!@#$%', 'PARTIAL_REBRAND');

      expect(result.transformation_summary).toContain('Channel-123_!@#$%');
      expect(result.transformation_summary).toContain('PARTIAL_REBRAND');
    });

    it('validateOutput should handle undefined output gracefully', () => {
      const validateFn = (service as any).validateOutput.bind(service);
      const result: OptimizationOutput = validateFn(undefined, 'UndefinedChannel');

      // Undefined output triggers fallback (guarded in service)
      expect(result.confidence_score).toBe(30); // fallback score
      expect(result.transformation_summary).toContain('UndefinedChannel');
      expect(result.transformation_summary).toContain('could not be completed');
      expect(result.transformation_summary).toContain('AI service unavailable');
    });

    it('validateOutput should handle null output gracefully', () => {
      const validateFn = (service as any).validateOutput.bind(service);
      const result: OptimizationOutput = validateFn(null, 'NullChannel');

      // Null/undefined output triggers fallback (since we added !output guard)
      expect(result.confidence_score).toBe(30); // fallback score
      expect(result.transformation_summary).toContain('NullChannel');
      expect(result.transformation_summary).toContain('could not be completed');
      expect(result.transformation_summary).toContain('AI service unavailable');
    });
  });
});
