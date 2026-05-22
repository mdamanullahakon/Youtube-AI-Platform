/* src/__tests__/utils/mock-setup.ts */
/**
 * Centralised mocks for Jest/Vitest tests.
 * Import this file at the top of any test that requires the shared services.
 */
import { vi } from 'vitest';

// Mock YouTube service – expose YouTubeAuthError class
vi.mock('../../services/youtube.service', async () => {
  const actual = await import('../../services/youtube.service');
  return {
    ...actual,
    YouTubeAuthError: class YouTubeAuthError extends Error {},
    // keep real implementations for other exports (uploadToYouTube etc.)
  };
});

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

// Additional mocks for services used in upload worker and pipeline
vi.mock('../../services/pre-upload-validation.service', () => ({
  PreUploadValidationGate: vi.fn().mockImplementation(() => ({
    validate: vi.fn().mockResolvedValue({ passed: true, blockers: [] }),
  })),
}));

vi.mock('../../services/quota-manager.service', () => ({
  quotaManager: {
    preCheck: vi.fn().mockResolvedValue({ canUpload: true, resetAt: new Date() }),
    recordUsage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/channel-limiter.service', () => ({
  channelLimiter: {
    check: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
    recordUpload: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../utils/logger', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  aiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  queueLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  pipelineLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/youtube.service', () => ({
  uploadToYouTube: vi.fn(),
  getVideoAnalytics: vi.fn(),
  YouTubeAuthError: class YouTubeAuthError extends Error {},
}));

vi.mock('bullmq', () => {
  const workerProcessors: any = {};
  const mockQueues: any = {};
  function Worker(queueName: string, processor: any, opts: any) {
    workerProcessors[queueName] = processor;
    return { name: queueName, processor, opts, on: vi.fn().mockReturnThis(), close: vi.fn().mockResolvedValue(undefined) };
  }
  function Queue(name: string, opts: any) {
    const q: any = { name, opts, add: vi.fn().mockImplementation((jobName: string, data: any) => Promise.resolve({ id: `job-${Date.now()}`, name: jobName, data })), addBulk: vi.fn().mockImplementation((jobs: any[]) => Promise.resolve(jobs.map((j, i) => ({ id: `bulk-${i}`, name: j.name, data: j.data })))), getJob: vi.fn().mockResolvedValue(null), getJobs: vi.fn().mockResolvedValue([]), obliterate: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
    mockQueues[name] = q;
    return q;
  }
  function QueueEvents(name: string, opts: any) { return { name, opts, on: vi.fn().mockReturnThis(), close: vi.fn().mockResolvedValue(undefined) }; }
  function FlowProducer() {
    const fp: any = {};
    fp.add = vi.fn().mockImplementation((flow: any) => Promise.resolve(flow));
    fp.getFlow = vi.fn().mockResolvedValue(null);
    fp.close = vi.fn().mockResolvedValue(undefined);
    return fp;
  }
  return { Worker, Queue, QueueEvents, FlowProducer };
});

// Mock prisma – minimal stub for tests that use DB calls
vi.mock('../../config/db', () => ({
  prisma: {
    videoProject: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn().mockResolvedValue(undefined) },
    youTubeAccount: { findFirst: vi.fn().mockResolvedValue(null) },
    uploadHistory: { upsert: vi.fn().mockResolvedValue(undefined), count: vi.fn().mockResolvedValue(0) },
    videoProject: { update: vi.fn().mockResolvedValue(undefined) },
  },
}));

export {};
