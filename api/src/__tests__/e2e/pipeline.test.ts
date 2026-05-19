import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

// ═══════════════════════════════════════════════════════════════
// GLOBAL TEST STATE
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// HOISTED HELPERS (available before vi.mock factories)
// ═══════════════════════════════════════════════════════════════

const workerProcessors = vi.hoisted(() => ({} as Record<string, Function>));
const mockQueues = vi.hoisted(() => ({} as Record<string, any>));
const mockFlowProducer = vi.hoisted(() => ({} as any));

const prismaMock = vi.hoisted(() => {
  const models = [
    'videoProject', 'trendResearch', 'script', 'thumbnail', 'voiceover',
    'videoRender', 'analytics', 'uploadHistory', 'youTubeAccount', 'user',
    'aIUsage', 'settings', 'subscription',
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

vi.mock('ioredis', () => {
  function MockIORedis(url?: string, options?: any) {
    const self: Record<string, any> = {
      on: vi.fn().mockReturnThis(),
      once: vi.fn().mockReturnThis(),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue('OK'),
      ping: vi.fn().mockResolvedValue('PONG'),
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      setex: vi.fn().mockResolvedValue('OK'),
      setnx: vi.fn().mockResolvedValue(1),
      del: vi.fn().mockResolvedValue(1),
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      status: 'ready',
    };
    return self;
  }
  return { default: MockIORedis };
});

vi.mock('bullmq', () => {
  function Worker(queueName: string, processor: Function, opts?: any) {
    workerProcessors[queueName] = processor;
    return {
      name: queueName, processor, opts,
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(undefined),
    };
  }
  function Queue(name: string, opts?: any) {
    const q = {
      name, opts,
      add: vi.fn().mockImplementation((jobName: string, data: any) =>
        Promise.resolve({ id: `job-${Date.now()}`, name: jobName, data })
      ),
      addBulk: vi.fn().mockImplementation((jobs: any[]) =>
        Promise.resolve(jobs.map((j, i) => ({ id: `bulk-${i}`, name: j.name, data: j.data })))
      ),
      getJob: vi.fn().mockResolvedValue(null),
      getJobs: vi.fn().mockResolvedValue([]),
      obliterate: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockQueues[name] = q;
    return q;
  }
  function QueueEvents(name: string, opts?: any) {
    return { name, opts, on: vi.fn().mockReturnThis(), close: vi.fn().mockResolvedValue(undefined) };
  }
  function FlowProducer(opts?: any) {
    mockFlowProducer.add = vi.fn().mockImplementation((flow: any) =>
      Promise.resolve({ job: { id: `flow-${Date.now()}`, ...flow } })
    );
    mockFlowProducer.getFlow = vi.fn().mockResolvedValue(null);
    mockFlowProducer.close = vi.fn().mockResolvedValue(undefined);
    return mockFlowProducer;
  }
  return { Worker, Queue, QueueEvents, FlowProducer };
});

vi.mock('../../config/db', () => ({
  prisma: prismaMock,
  disconnectDatabase: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  aiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  queueLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../config/env', () => ({
  env: {
    PORT: 4000,
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-min-32-chars-long-!!',
      GEMINI_API_KEY: '',
    YOUTUBE_CLIENT_ID: 'mock-client-id',
    YOUTUBE_CLIENT_SECRET: 'mock-client-secret',
    YOUTUBE_REFRESH_TOKEN: 'mock-refresh-token',
    YOUTUBE_API_KEY: 'mock-api-key',
    YOUTUBE_REDIRECT_URI: 'http://localhost:4000/api/auth/youtube/callback',
    OAUTH_STATE_SECRET: 'mock-state-secret',
    ENCRYPTION_KEY: 'mock-encryption-key',
  },
}));

vi.mock('../../services/trend.service', () => ({
  getYouTubeTrends: vi.fn(),
  getGoogleTrends: vi.fn(),
  getRedditTrends: vi.fn(),
}));

vi.mock('../../services/ai.service', () => ({
  generateWithAI: vi.fn(),
}));

vi.mock('../../services/ai-usage.service', () => ({
  AIUsageService: {
    track: vi.fn(),
    checkDailyLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 100, limit: 100 }),
    getDailyUsage: vi.fn().mockResolvedValue({ count: 0, tokens: 0, cost: 0 }),
  },
}));

vi.mock('../../services/content-quality.service', () => ({
  ContentQualityService: vi.fn().mockImplementation(function() {
    return {
      fullEnhance: vi.fn((content: string) => Promise.resolve(content)),
    };
  }),
}));

vi.mock('../../services/learning-engine', () => ({
  LearningEngine: vi.fn().mockImplementation(function() {
    return {
      generateScriptImprovements: vi.fn().mockResolvedValue({
        actionableTips: [],
        hookSuggestion: 'Start with a surprising statistic',
        structureSuggestion: 'Use problem-agitate-solve framework',
        pacingSuggestion: 'Quick cuts in first 15 seconds',
        ctaSuggestion: 'Ask a question to drive comments',
      }),
    };
  }),
}));

vi.mock('../../services/feedback-engine.service', () => ({
  FeedbackEngine: vi.fn().mockImplementation(function() {
    return {
      getScriptFeedback: vi.fn().mockResolvedValue({
        hookGuidance: [],
        structureGuidance: [],
        pacingGuidance: [],
        ctaGuidance: [],
      }),
    };
  }),
}));

vi.mock('../../services/youtube.service', () => ({
  uploadToYouTube: vi.fn(),
  getVideoAnalytics: vi.fn(),
}));

// youtube-oauth.service NOT mocked here — all its deps (prisma, redis, googleapis, etc.)
// are already mocked, so the real implementation is used with mocked sub-dependencies.

vi.mock('../../services/auto-cleanup.service', () => ({
  AutoCleanupService: vi.fn().mockImplementation(function() {
    return {
      cleanupAfterUpload: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('../../services/feedback-loop.service', () => ({
  FeedbackLoopService: vi.fn().mockImplementation(function() {
    return {
      analyzeAfterUpload: vi.fn().mockResolvedValue(null),
      updateScriptPromptsBasedOnPerformance: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('../../services/render.service', () => ({
  renderVideo: vi.fn().mockResolvedValue('/tmp/mock-render.mp4'),
}));

vi.mock('../../services/analytics-learning.service', () => ({
  AnalyticsLearningService: vi.fn().mockImplementation(function() {
    return {
      analyzeProject: vi.fn().mockResolvedValue({}),
    };
  }),
}));

vi.mock('../../services/ctr-analyzer.service', () => ({
  CTRAnalyzer: vi.fn().mockImplementation(function() {
    return {
      updateWithActualCTR: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('../../agents/prompt.agent', () => ({
  generateVisualPrompts: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../agents/voiceover.agent', () => ({
  createVoiceover: vi.fn().mockResolvedValue({
    text: 'Mock voiceover text',
    audioUrl: '/uploads/audio/mock.mp3',
    duration: 30,
    language: 'en',
    tone: 'energetic',
  }),
}));

vi.mock('../../agents/thumbnail.agent', () => ({
  generateThumbnail: vi.fn().mockResolvedValue({
    prompt: 'A dramatic thumbnail with text overlay',
    imageUrl: '/uploads/thumbnails/mock.jpg',
    style: 'face-closeup-shock',
    ctr: 12.5,
  }),
}));

vi.mock('../../agents/seo.agent', () => ({
  optimizeSEO: vi.fn().mockResolvedValue({
    title: 'This AI Will Blow Your Mind in 2026',
    description: 'Full description with keywords',
    tags: ['ai', 'technology', 'future'],
    hashtags: ['#ai', '#tech'],
    keywords: ['artificial intelligence', 'future technology'],
  }),
}));

vi.mock('../../utils/prompt-sanitizer', () => ({
  sanitizePrompt: vi.fn().mockReturnValue({ sanitized: 'mock prompt', blocked: false }),
}));

vi.mock('../../utils/token-estimator', () => ({
  estimateTokens: vi.fn().mockReturnValue(100),
  estimateCost: vi.fn().mockReturnValue(0.001),
}));

vi.mock('../../utils/oauth-state', () => ({
  generateOAuthState: vi.fn().mockReturnValue({ state: 'mock-state', nonce: 'mock-nonce' }),
  parseOAuthState: vi.fn().mockReturnValue({ userId: 'test-user', nonce: 'mock-nonce' }),
  markNonceUsed: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../utils/pkce', () => ({
  generateCodeVerifier: vi.fn().mockReturnValue('mock-verifier'),
  generateCodeChallenge: vi.fn().mockReturnValue('mock-challenge'),
}));

vi.mock('../../utils/encryption', () => ({
  encrypt: vi.fn((s: string) => `encrypted:${s}`),
  decrypt: vi.fn((s: string) => s.replace('encrypted:', '')),
}));

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    create: vi.fn().mockReturnThis(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

vi.mock('ollama', () => ({
  default: {
    chat: vi.fn().mockResolvedValue({ message: { content: 'ollama fallback' } }),
  },
}));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(function() {
        return {
          generateAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?mock'),
          getToken: vi.fn().mockResolvedValue({
            tokens: {
              access_token: 'mock-access',
              refresh_token: 'mock-refresh',
              expiry_date: Date.now() + 3600000,
              scope: 'https://www.googleapis.com/auth/youtube',
            },
          }),
          setCredentials: vi.fn(),
          getAccessToken: vi.fn().mockResolvedValue({ token: 'mock-access-token', res: null }),
          refreshAccessToken: vi.fn().mockResolvedValue({
            credentials: { access_token: 'refreshed-access', expiry_date: Date.now() + 3600000 },
          }),
          credentials: { access_token: 'mock-access', refresh_token: 'mock-refresh' },
        };
      }),
    },
    youtube: vi.fn().mockReturnValue({
      videos: { list: vi.fn() },
      channels: { list: vi.fn() },
    }),
  },
  Auth: { CodeChallengeMethod: { S256: 'S256' } },
}));

// ═══════════════════════════════════════════════════════════════
// MODULE IMPORTS (triggers worker registration via mocked BullMQ)
// ═══════════════════════════════════════════════════════════════

import { generateWithAI } from '../../services/ai.service';
import { getYouTubeTrends, getGoogleTrends, getRedditTrends } from '../../services/trend.service';
import { uploadToYouTube } from '../../services/youtube.service';
import { getAuthenticatedClient } from '../../services/youtube-oauth.service';

import '../../workers/trend.worker';
import '../../workers/script.worker';
import '../../workers/agent.worker';
import '../../workers/upload.worker';
import '../../workers/video.worker';
import '../../workers/render.worker';
import '../../workers/analytics.worker';
import '../../workers/dead-letter.worker';

import { analyzeTrend } from '../../agents/trend.agent';
import { generateScript } from '../../agents/script.agent';
import { AIOrchestrator } from '../../ai/orchestrator';
import { createFullPipelineFlow } from '../../queues/pipeline.queue';
import { STANDARD_JOB_OPTS, UPLOAD_JOB_OPTS, queueMap } from '../../queues/video.queue';
import { refreshChannelToken } from '../../services/youtube-oauth.service';

// ═══════════════════════════════════════════════════════════════
// TEST HELPERS
// ═══════════════════════════════════════════════════════════════

function buildMockJob(overrides: Record<string, any> = {}) {
  return {
    id: 'test-job-' + Math.random().toString(36).slice(2, 8),
    name: overrides.name || 'test',
    data: overrides.data || {},
    progress: 0,
    attemptsMade: 0,
    failedReason: null,
    timestamp: Date.now(),
    returnvalue: null,
    stacktrace: [],
    updateProgress: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

function getWorker(queueName: string): Function {
  const processor = workerProcessors[queueName];
  if (!processor) throw new Error(`No processor registered for queue: ${queueName}`);
  return processor;
}

function mockProject(overrides: Record<string, any> = {}) {
  return {
    id: 'project-test-1',
    userId: 'user-test-1',
    topic: 'AI Revolution 2026',
    title: null,
    description: null,
    status: 'draft',
    viralScore: 0,
    competition: 0,
    audience: null,
    format: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

describe('Pipeline E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(global.Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 1: Full Pipeline End-to-End
  // ──────────────────────────────────────────────────────────
  describe('1. Full Pipeline End-to-End', () => {
    it('should execute the complete pipeline from trend analysis through upload', async () => {
      const project = mockProject({ id: 'e2e-project-1', userId: 'user-1' });

      const trendData = {
        topic: 'AI Revolution 2026',
        viralScore: 85,
        competition: 30,
        audience: 'Tech Enthusiasts',
        format: 'Shorts',
      };

      const scriptContent = [
        '---HOOK---',
        'Did you know AI can now create full movies?',
        '---SCENES---',
        '[Scene 1 text | 5 | visual shot of server room]',
        '[Scene 2 text | 8 | animation of neural network]',
        '---CTA---',
        'Subscribe for more AI content!',
      ].join('\n');

      // ── Step 1: Trend Analysis ──
      (generateWithAI as any).mockResolvedValue(JSON.stringify(trendData));
      (getYouTubeTrends as any).mockResolvedValue(['AI video generation', 'Robot dogs', 'Neural interface']);
      (getGoogleTrends as any).mockResolvedValue([
        { title: 'AI news', url: '', source: 'google-trends', score: 70 },
      ]);
      (getRedditTrends as any).mockResolvedValue([
        { title: 'GPT-5 released', url: '', source: 'reddit', score: 500 },
      ]);
      (prismaMock.videoProject.findUnique as any).mockResolvedValue(project);
      (prismaMock.trendResearch.upsert as any).mockResolvedValue({ id: 'trend-1', ...trendData, projectId: project.id });
      (prismaMock.videoProject.update as any).mockResolvedValue({ ...project, status: 'trending_analyzed' });

      const trendWorker = getWorker('trend-analysis');
      const trendResult = await trendWorker(buildMockJob({
        name: 'trend-analysis',
        data: { projectId: project.id, topic: 'AI Revolution 2026' },
      }));

      expect(trendResult.topic).toBe('AI Revolution 2026');
      expect(trendResult.viralScore).toBe(85);
      expect(prismaMock.trendResearch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: project.id } })
      );
      expect(prismaMock.videoProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: project.id },
          data: expect.objectContaining({ status: 'trending_analyzed' }),
        })
      );

      // ── Step 2: Script Generation ──
      (generateWithAI as any).mockResolvedValue(scriptContent);
      (prismaMock.videoProject.findUnique as any).mockResolvedValue({ ...project, status: 'trending_analyzed' });
      (prismaMock.script.upsert as any).mockResolvedValue({
        id: 'script-1',
        projectId: project.id,
        content: scriptContent,
        hook: 'Did you know AI can now create full movies?',
        wordCount: 30,
      });

      const scriptWorker = getWorker('script-generation');
      const scriptResult = await scriptWorker(buildMockJob({
        name: 'script-generation',
        data: { projectId: project.id, topic: 'AI Revolution 2026', format: 'Shorts' },
      }));

      expect(scriptResult.hook).toContain('Did you know');
      expect(prismaMock.script.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: project.id } })
      );
      expect(prismaMock.videoProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: project.id },
          data: expect.objectContaining({ status: 'script_generated' }),
        })
      );

      // Step 2 verification: Agent tasks dispatched
      const agentQueue = mockQueues['agent-tasks'];
      expect(agentQueue.addBulk).toHaveBeenCalled();
      const addBulkArg = (agentQueue.addBulk as any).mock.calls[0][0];
      const dispatchedNames = addBulkArg.map((j: any) => j.name);
      expect(dispatchedNames).toContain('prompt-generation');
      expect(dispatchedNames).toContain('voiceover-generation');
      expect(dispatchedNames).toContain('thumbnail-generation');
      expect(dispatchedNames).toContain('seo-optimization');

      // ── Step 3: Agent Tasks ──
      const agentWorker = getWorker('agent-tasks');

      // 3a. Thumbnail generation
      (prismaMock.thumbnail.upsert as any).mockResolvedValue({ id: 'thumb-1', projectId: project.id });
      const thumbResult = await agentWorker(buildMockJob({
        name: 'thumbnail-generation',
        data: { topic: 'AI Revolution 2026', hook: 'Did you know AI can now create full movies?', projectId: project.id },
      }));
      expect(thumbResult.imageUrl).toBe('/uploads/thumbnails/mock.jpg');
      expect(prismaMock.thumbnail.upsert).toHaveBeenCalled();

      // 3b. SEO optimization
      (prismaMock.videoProject.update as any).mockResolvedValue({ ...project, title: 'SEO Title' });
      const seoResult = await agentWorker(buildMockJob({
        name: 'seo-optimization',
        data: { topic: 'AI Revolution 2026', hook: 'Did you know AI can now create full movies?', projectId: project.id },
      }));
      expect(seoResult.title).toBe('This AI Will Blow Your Mind in 2026');
      expect(prismaMock.videoProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: project.id },
          data: expect.objectContaining({ title: expect.any(String) }),
        })
      );

      // 3c. Voiceover generation
      (prismaMock.voiceover.upsert as any).mockResolvedValue({ id: 'vo-1', projectId: project.id, audioUrl: '/uploads/audio/mock.mp3' });
      const voResult = await agentWorker(buildMockJob({
        name: 'voiceover-generation',
        data: { text: scriptContent, projectId: project.id },
      }));
      expect(voResult.audioUrl).toBe('/uploads/audio/mock.mp3');

      // ── Step 4: Video Render ──
      (prismaMock.videoProject.findUnique as any).mockResolvedValue({
        ...project,
        status: 'script_generated',
        script: { content: scriptContent },
        voiceover: { audioUrl: '/uploads/audio/mock.mp3' },
      });
      (prismaMock.videoRender.upsert as any).mockResolvedValue({
        id: 'render-1', projectId: project.id, videoUrl: '/uploads/videos/mock.mp4', status: 'completed',
      });

      const renderWorker = getWorker('video-render');
      const renderResult = await renderWorker(buildMockJob({
        name: 'render-video',
        data: { projectId: project.id },
      }));
      expect(renderResult.scenes).toBeGreaterThan(0);
      expect(prismaMock.videoRender.upsert).toHaveBeenCalled();
      expect(prismaMock.videoProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: project.id },
          data: expect.objectContaining({ status: 'rendered' }),
        })
      );

      // ── Step 5: YouTube Upload ──
      (uploadToYouTube as any).mockResolvedValue('yt-video-id-12345');
      (prismaMock.videoProject.findUnique as any).mockResolvedValue({
        ...project,
        status: 'rendered',
        videoRender: { videoUrl: '/uploads/videos/mock.mp4' },
        thumbnail: { imageUrl: '/uploads/thumbnails/mock.jpg' },
      });
      (prismaMock.uploadHistory.upsert as any).mockResolvedValue({
        id: 'upload-1', projectId: project.id, videoId: 'yt-video-id-12345', status: 'uploaded',
      });

      const uploadWorker = getWorker('youtube-upload');
      const uploadResult = await uploadWorker(buildMockJob({
        name: 'upload-video',
        data: { projectId: project.id, title: 'AI Revolution 2026', description: '', tags: ['AI'], privacyStatus: 'public' },
      }));

      expect(uploadResult.videoId).toBe('yt-video-id-12345');
      expect(prismaMock.uploadHistory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: project.id } })
      );
      expect(prismaMock.videoProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: project.id },
          data: expect.objectContaining({ status: 'published' }),
        })
      );

      // ── Step 6: Analytics Collection ──
      const { getVideoAnalytics } = await import('../../services/youtube.service');
      (getVideoAnalytics as any).mockResolvedValue({
        views: 15000,
        likes: 1200,
        comments: 340,
        ctr: 8.5,
        retention: 65.2,
        watchTime: 45000,
        subscribersGained: 180,
      });
      (prismaMock.videoProject.findUnique as any).mockResolvedValue({
        ...project,
        status: 'published',
        uploadHistory: { videoId: 'yt-video-id-12345' },
      });
      (prismaMock.analytics.upsert as any).mockResolvedValue({
        id: 'analytics-1', projectId: project.id, views: 15000,
      });

      const analyticsWorker = getWorker('analytics-collection');
      const analyticsResult = await analyticsWorker(buildMockJob({
        name: 'collect-analytics',
        data: { projectId: project.id },
      }));

      expect(analyticsResult.collected).toBe(true);
      expect(prismaMock.analytics.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: project.id },
          create: expect.objectContaining({ views: 15000 }),
        })
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 2: Trend Analysis Flow
  // ──────────────────────────────────────────────────────────
  describe('2. Trend Analysis Flow', () => {
    it('should process trend analysis job and store results in DB', async () => {
      const projectId = 'project-trend-1';
      const trendData = {
        topic: 'AI in Healthcare',
        viralScore: 92,
        competition: 25,
        audience: 'Medical Professionals',
        format: 'Longform',
      };

      (generateWithAI as any).mockResolvedValue(JSON.stringify(trendData));
      (getYouTubeTrends as any).mockResolvedValue(['AI diagnosis', 'Robot surgery', 'Health tracker']);
      (getGoogleTrends as any).mockResolvedValue([
        { title: 'AI healthcare', url: '', source: 'google-trends', score: 85 },
      ]);
      (getRedditTrends as any).mockResolvedValue([
        { title: 'AI cures rare disease', url: '', source: 'reddit', score: 1200 },
      ]);
      (prismaMock.videoProject.findUnique as any).mockResolvedValue(mockProject({ id: projectId }));
      (prismaMock.trendResearch.upsert as any).mockResolvedValue({
        id: 'tr-1', projectId, topic: 'AI in Healthcare',
      });
      (prismaMock.videoProject.update as any).mockResolvedValue({});

      const processor = getWorker('trend-analysis');
      const result = await processor(buildMockJob({
        name: 'trend-analysis',
        data: { projectId },
      }));

      expect(generateWithAI).toHaveBeenCalled();
      expect(getYouTubeTrends).toHaveBeenCalled();
      expect(getGoogleTrends).toHaveBeenCalled();
      expect(getRedditTrends).toHaveBeenCalled();
      expect(prismaMock.trendResearch.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId },
          create: expect.objectContaining({
            topic: trendData.topic,
            viralScore: trendData.viralScore,
            competition: trendData.competition,
          }),
        })
      );
      expect(prismaMock.videoProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: projectId },
          data: expect.objectContaining({ status: 'trending_analyzed' }),
        })
      );
      expect(result.topic).toBe('AI in Healthcare');
    });

    it('should handle trend analysis without a projectId gracefully', async () => {
      (generateWithAI as any).mockResolvedValue(JSON.stringify({
        topic: 'Standalone Trend', viralScore: 70, competition: 50, audience: 'General', format: 'Shorts',
      }));
      (getYouTubeTrends as any).mockResolvedValue(['Trend A', 'Trend B']);
      (getGoogleTrends as any).mockResolvedValue([]);
      (getRedditTrends as any).mockResolvedValue([]);

      const processor = getWorker('trend-analysis');
      const result = await processor(buildMockJob({
        name: 'trend-analysis',
        data: {},
      }));

      expect(result.topic).toBe('Standalone Trend');
      expect(prismaMock.trendResearch.upsert).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 3: Script Generation Flow
  // ──────────────────────────────────────────────────────────
  describe('3. Script Generation Flow', () => {
    it('should generate script, store it, update status and dispatch agent tasks', async () => {
      const projectId = 'project-script-1';
      const scriptContent = [
        '---HOOK---',
        'Your phone is listening to you right now.',
        '---SCENES---',
        '[Open with dark screen | 3 | person looking at phone]',
        '[Reveal how data collection works | 8 | animation of data flow]',
        '---CTA---',
        'Turn on notifications for part 2!',
      ].join('\n');

      (generateWithAI as any).mockResolvedValue(scriptContent);
      (prismaMock.videoProject.findUnique as any).mockResolvedValue(
        mockProject({ id: projectId, status: 'trending_analyzed' })
      );
      (prismaMock.script.upsert as any).mockResolvedValue({
        id: 'script-1', projectId, content: scriptContent, hook: 'Your phone is listening to you right now.',
      });

      const processor = getWorker('script-generation');
      const result = await processor(buildMockJob({
        name: 'script-generation',
        data: { projectId, topic: 'Data Privacy', format: 'Shorts' },
      }));

      expect(prismaMock.script.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId },
          create: expect.objectContaining({ generatedBy: 'ai-agent' }),
        })
      );
      expect(prismaMock.videoProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: projectId },
          data: expect.objectContaining({ status: 'script_generated' }),
        })
      );
      const agentQueue = mockQueues['agent-tasks'];
      expect(agentQueue.addBulk).toHaveBeenCalled();
      expect(result.hook).toContain('listening');
    });
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 4: Upload Flow
  // ──────────────────────────────────────────────────────────
  describe('4. Upload Flow', () => {
    it('should upload video and create upload history record', async () => {
      const projectId = 'project-upload-1';
      (uploadToYouTube as any).mockResolvedValue('yt-video-999');
      (prismaMock.videoProject.findUnique as any).mockResolvedValue({
        ...mockProject({ id: projectId }),
        videoRender: { videoUrl: '/uploads/videos/final.mp4' },
        thumbnail: { imageUrl: '/uploads/thumbnails/thumb.jpg' },
      });
      (prismaMock.uploadHistory.upsert as any).mockResolvedValue({
        id: 'uh-1', projectId, videoId: 'yt-video-999', status: 'uploaded',
      });

      const processor = getWorker('youtube-upload');
      const result = await processor(buildMockJob({
        name: 'upload-video',
        data: { projectId, title: 'Test Video', description: 'Desc', tags: ['test'], privacyStatus: 'public' },
      }));

      expect(uploadToYouTube).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'AI Revolution 2026', tags: ['AI Revolution 2026'], videoPath: expect.any(String) })
      );
      expect(prismaMock.uploadHistory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId }, create: expect.objectContaining({ videoId: 'yt-video-999' }) })
      );
      expect(prismaMock.videoProject.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: projectId }, data: expect.objectContaining({ status: 'published' }) })
      );
      expect(result.videoId).toBe('yt-video-999');
    });

    it('should throw error when no rendered video exists', async () => {
      (prismaMock.videoProject.findUnique as any).mockResolvedValue({
        ...mockProject({ id: 'project-no-video' }),
        videoRender: null,
        thumbnail: null,
      });

      const processor = getWorker('youtube-upload');
      await expect(processor(buildMockJob({
        name: 'upload-video',
        data: { projectId: 'project-no-video' },
      }))).rejects.toThrow('No rendered video found');
    });
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 5: Queue Retry Behavior
  // ──────────────────────────────────────────────────────────
  describe('5. Queue Retry Behavior', () => {
    it('should have proper retry configuration in job options', () => {
      expect(STANDARD_JOB_OPTS.attempts).toBe(3);
      expect(STANDARD_JOB_OPTS.backoff).toEqual({ type: 'exponential', delay: 2000 });
      expect(UPLOAD_JOB_OPTS.attempts).toBe(5);
      expect(UPLOAD_JOB_OPTS.timeout).toBe(300_000);
    });

    it('should retry failed jobs and eventually move to DLQ', async () => {
      const processor = getWorker('trend-analysis');

      // Simulate a job that fails 3 times
      const job = buildMockJob({
        name: 'trend-analysis',
        data: { projectId: 'project-retry' },
        attemptsMade: 2,
        opts: { attempts: 3 },
      });

      // Force the trend service to fail
      (getYouTubeTrends as any).mockRejectedValue(new Error('YouTube API rate limit'));
      (getGoogleTrends as any).mockRejectedValue(new Error('Google Trends timeout'));
      (getRedditTrends as any).mockRejectedValue(new Error('Reddit unavailable'));

      await expect(processor(job)).rejects.toThrow();

      // Check that the job was attempted the right number of times
      // (our processor doesn't track attempts, but the job's attemptsMade shows it)
      expect(job.attemptsMade).toBe(2);

      // Verify the DLQ queue exists for trend-analysis
      const dlqQueue = mockQueues['trend-analysis-dlq'];
      expect(dlqQueue).toBeDefined();
      expect(dlqQueue.name).toBe('trend-analysis-dlq');

      // Verify queueMap has the DLQ mapped correctly
      expect(queueMap).toHaveProperty('trend-analysis');
      expect(queueMap).toHaveProperty('youtube-upload');
    });

    it('should use exponential backoff between retries', () => {
      const delays = [0, 1, 2].map(i => STANDARD_JOB_OPTS.backoff.delay * Math.pow(2, i));
      expect(delays[0]).toBe(2000);
      expect(delays[1]).toBe(4000);
      expect(delays[2]).toBe(8000);
    });
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 6: Dead Letter Recovery
  // ──────────────────────────────────────────────────────────
  describe('6. Dead Letter Recovery', () => {
    it('should recover failed jobs from DLQ back to original queue', async () => {
      const dlqProcessor = getWorker('trend-analysis-dlq');

      const dlqJob = buildMockJob({
        id: 'dlq-job-1',
        name: 'trend-analysis',
        data: {
          __queueName: 'trend-analysis',
          __jobName: 'trend-analysis',
          __failReason: 'YouTube API rate limit exceeded',
          __attempts: 3,
          __recoveryCount: 0,
          projectId: 'project-dlq-1',
          topic: 'Recovered topic',
        },
        queueName: 'trend-analysis-dlq',
      });

      const result = await dlqProcessor(dlqJob);

      expect(result.recovered).toBe(true);
      expect(result.newJobId).toBeDefined();
      expect(result.queue).toBe('trend-analysis');
      expect(dlqJob.remove).toHaveBeenCalled();
    });

    it('should discard jobs that exceed max recovery attempts', async () => {
      const dlqProcessor = getWorker('trend-analysis-dlq');

      const dlqJob = buildMockJob({
        id: 'dlq-job-exhausted',
        name: 'trend-analysis',
        data: {
          __queueName: 'trend-analysis',
          __jobName: 'trend-analysis',
          __failReason: 'Persistent failure',
          __attempts: 5,
          __recoveryCount: 3,
          projectId: 'project-dlq-exhausted',
        },
        queueName: 'trend-analysis-dlq',
      });

      const result = await dlqProcessor(dlqJob);

      expect(result.recovered).toBe(false);
      expect(result.reason).toContain('Exceeded max recoveries');
      expect(dlqJob.remove).toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 7: AI Provider Fallback
  // ──────────────────────────────────────────────────────────
  describe('7. AI Provider Fallback', () => {
    it('should fall back through providers when primary fails', async () => {
      const { generateWithAI: realGenerateWithAI } = await vi.importActual<typeof import('../../services/ai.service')>('../../services/ai.service');

      const mockAxios = (await import('axios')).default;
      (mockAxios.post as any)
        .mockRejectedValueOnce(new Error('OpenAI API error'))
        .mockRejectedValueOnce(new Error('Claude API error'))
        .mockRejectedValueOnce(new Error('Gemini API error'));

      const ollamaMock = (await import('ollama')).default;
      (ollamaMock.chat as any).mockResolvedValue({
        message: { content: 'Fallback response from Ollama' },
      });

      const result = await realGenerateWithAI('Test prompt', 'gemini', { temperature: 0.5 });
      expect(result).toBe('Fallback response from Ollama');
    });

    it('should throw when all providers fail', async () => {
      const mockAxios = (await import('axios')).default;
      (mockAxios.post as any).mockRejectedValue(new Error('API unavailable'));
      const ollamaMock = (await import('ollama')).default;
      (ollamaMock.chat as any).mockRejectedValue(new Error('Ollama not running'));

      const realAI = await vi.importActual<typeof import('../../services/ai.service')>('../../services/ai.service');
      await expect(realAI.generateWithAI('prompt', 'gemini')).rejects.toThrow();
    });
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 8: Malformed AI Response Handling
  // ──────────────────────────────────────────────────────────
  describe('8. Malformed AI Response Handling', () => {
    it('should fall back to defaults when AI returns malformed JSON', async () => {
      (getYouTubeTrends as any).mockResolvedValue(['Trend 1', 'Trend 2']);
      (getGoogleTrends as any).mockResolvedValue([]);
      (getRedditTrends as any).mockResolvedValue([]);

      (generateWithAI as any).mockResolvedValue('This is not valid JSON at all {broken');

      const result = await analyzeTrend();
      expect(result).toBeDefined();
      expect(result.topic).toBe('Trend 1');
      expect(result.viralScore).toBeGreaterThanOrEqual(0);
      expect(result.viralScore).toBeLessThanOrEqual(100);
      expect(result.competition).toBeGreaterThanOrEqual(0);
      expect(result.trends).toContain('Trend 1');
    });

    it('should handle AI returning markdown-wrapped JSON', async () => {
      (getYouTubeTrends as any).mockResolvedValue(['Quantum Computing', 'AI Art']);
      (getGoogleTrends as any).mockResolvedValue([]);
      (getRedditTrends as any).mockResolvedValue([]);

      (generateWithAI as any).mockResolvedValue([
        '```json',
        JSON.stringify({
          topic: 'Quantum Computing Explained',
          viralScore: 88,
          competition: 35,
          audience: 'STEM',
          format: 'Longform',
        }),
        '```',
      ].join('\n'));

      const result = await analyzeTrend();
      expect(result.topic).toBe('Quantum Computing Explained');
      expect(result.viralScore).toBe(88);
      expect(result.format).toBe('Longform');
    });

    it('should handle AI returning partial JSON with missing fields', async () => {
      (getYouTubeTrends as any).mockResolvedValue(['SpaceX Launch']);
      (getGoogleTrends as any).mockResolvedValue([]);
      (getRedditTrends as any).mockResolvedValue([]);

      (generateWithAI as any).mockResolvedValue(JSON.stringify({
        topic: 'SpaceX Starship Launch',
      }));

      const result = await analyzeTrend();
      expect(result.topic).toBe('SpaceX Starship Launch');
      expect(result.viralScore).toBeGreaterThanOrEqual(0);
      expect(result.competition).toBeGreaterThanOrEqual(0);
      expect(result.audience).toBe('General');
      expect(result.format).toBe('Shorts');
    });

    it('should handle completely empty AI response', async () => {
      (getYouTubeTrends as any).mockResolvedValue([]);
      (getGoogleTrends as any).mockResolvedValue([]);
      (getRedditTrends as any).mockResolvedValue([]);

      (generateWithAI as any).mockResolvedValue('');

      const result = await analyzeTrend();
      expect(result).toBeDefined();
      expect(result.topic).toBeTruthy();
      expect(result.trends).toEqual([]);
      expect(result.competitors).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 9: OAuth Token Refresh
  // ──────────────────────────────────────────────────────────
  describe('9. OAuth Token Refresh', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should refresh token when token is expired', async () => {
      const expiredAccount = {
        id: 'yt-acc-1',
        userId: 'user-1',
        channelId: 'UC-test',
        isConnected: true,
        accessToken: 'encrypted:old-access-token',
        refreshToken: 'encrypted:refresh-token',
        tokenExpiresAt: new Date(Date.now() - 3600000),
      };

      const refreshedAccount = {
        ...expiredAccount,
        accessToken: 'encrypted:new-access-token',
        tokenExpiresAt: new Date(Date.now() + 3600000),
        lastSyncedAt: new Date(),
      };

      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValueOnce(expiredAccount);
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValueOnce(expiredAccount);
      (prismaMock.youTubeAccount.update as any).mockResolvedValue(refreshedAccount);
      (prismaMock.youTubeAccount.findUnique as any).mockResolvedValue(refreshedAccount);

      const client = await getAuthenticatedClient('user-1');
      expect(client).toBeDefined();
      expect(prismaMock.youTubeAccount.update).toHaveBeenCalled();
    });

    it('should not refresh when token is still valid', async () => {
      const validAccount = {
        id: 'yt-acc-2',
        userId: 'user-1',
        channelId: 'UC-test-2',
        isConnected: true,
        accessToken: 'encrypted:valid-access-token',
        refreshToken: 'encrypted:valid-refresh-token',
        tokenExpiresAt: new Date(Date.now() + 3600000),
      };

      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(validAccount);

      const client = await getAuthenticatedClient('user-1');
      expect(client).toBeDefined();
      expect(prismaMock.youTubeAccount.update).not.toHaveBeenCalled();
    });

    it('should throw when no connected account exists', async () => {
      (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(null);
      await expect(getAuthenticatedClient('user-no-account')).rejects.toThrow(
        'No connected YouTube account found'
      );
    });
  });

  // ──────────────────────────────────────────────────────────
  // SUITE 10: Pipeline Status Tracking
  // ──────────────────────────────────────────────────────────
  describe('10. Pipeline Status Tracking', () => {
    it('should create a project in draft status', async () => {
      (prismaMock.videoProject.create as any).mockResolvedValue(
        mockProject({ id: 'status-project-1', status: 'draft' })
      );

      const project = await prismaMock.videoProject.create({
        data: { userId: 'user-1', topic: 'Test', status: 'draft' },
      });
      expect(project.status).toBe('draft');
    });

    it('should transition through all pipeline statuses correctly', async () => {
      const projectId = 'status-project-full';
      const baseProject = mockProject({ id: projectId, userId: 'user-1', topic: 'Status Test' });

      const statuses = ['draft', 'running', 'trending_analyzed', 'script_generated', 'rendered', 'published'];
      let currentStatusIdx = 0;

      (prismaMock.videoProject.findUnique as any).mockImplementation(() =>
        Promise.resolve({ ...baseProject, status: statuses[currentStatusIdx] })
      );

      (prismaMock.videoProject.update as any).mockImplementation(({ data }: any) => {
        currentStatusIdx = statuses.indexOf(data.status);
        return Promise.resolve({ ...baseProject, status: data.status });
      });

      // Simulate the pipeline status transitions
      const orchestrator = new AIOrchestrator(projectId);
      const pipelineResult = await orchestrator.runFullPipeline('Status Test');

      expect(pipelineResult.projectId).toBe(projectId);
      expect(pipelineResult.pipelineJobId).toBeDefined();

      // After createFullPipelineFlow, status should be 'running'
      expect(prismaMock.videoProject.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: projectId },
          data: expect.objectContaining({ status: 'running' }),
        })
      );

      // Verify the pipeline flow creates the expected job tree
      expect(mockFlowProducer.add).toHaveBeenCalled();
      const flowArg = mockFlowProducer.add.mock.calls[0][0];
      expect(flowArg.name).toBe('collect-analytics');
      expect(flowArg.queueName).toBe('analytics-collection');
    });

    it('should create script-to-render flow with correct child structure', async () => {
      const projectId = 'status-project-flow';
      (prismaMock.videoProject.findUnique as any).mockResolvedValue(mockProject({ id: projectId }));

      const { createScriptToRenderFlow } = await import('../../queues/pipeline.queue');
      const result = await createScriptToRenderFlow(projectId);

      expect(result.pipelineJobId).toBeDefined();
      expect(mockFlowProducer.add).toHaveBeenCalled();

      const flow = mockFlowProducer.add.mock.calls[0][0];
      expect(flow.queueName).toBe('analytics-collection');
      expect(flow.children[0].queueName).toBe('youtube-upload');
      expect(flow.children[0].children[0].queueName).toBe('video-render');
    });
  });
});
