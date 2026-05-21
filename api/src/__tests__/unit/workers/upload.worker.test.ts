import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildMockJob } from '../../helpers/factories';

const mockUploadToYouTube = vi.hoisted(() => vi.fn());
const mockPrismaFindUnique = vi.hoisted(() => vi.fn());
const mockPrismaUpsert = vi.hoisted(() => vi.fn());
const mockPrismaVideoUpdate = vi.hoisted(() => vi.fn());
const mockUploadHistoryCount = vi.hoisted(() => vi.fn());
const mockQuotaRecordUsage = vi.hoisted(() => vi.fn());
const mockChannelRecordUpload = vi.hoisted(() => vi.fn());
const mockQuotaPreCheck = vi.hoisted(() => vi.fn());
const mockChannelCheck = vi.hoisted(() => vi.fn());
const capturedProcessors: Record<string, Function> = {};

vi.mock('ioredis', () => {
  function MockIORedis() {
    return { on: vi.fn().mockReturnThis(), status: 'ready', quit: vi.fn().mockResolvedValue('OK') };
  }
  return { default: MockIORedis };
});

vi.mock('bullmq', () => {
  function Worker(this: any, queueName: string, processor: Function, opts?: any) {
    capturedProcessors[queueName] = processor;
    this.name = queueName;
    this.processor = processor;
    this.opts = opts;
    this.on = vi.fn().mockReturnThis();
    this.close = vi.fn().mockResolvedValue(undefined);
  }
  return { Worker: Worker as any };
});

vi.mock('../../../queues/video.queue', () => ({
  uploadQueue: {
    name: 'youtube-upload',
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0 }),
  },
}));

vi.mock('../../../config/db', () => ({
  prisma: {
    videoProject: { findUnique: mockPrismaFindUnique, update: mockPrismaVideoUpdate },
    uploadHistory: { upsert: mockPrismaUpsert, count: mockUploadHistoryCount },
  },
  disconnectDatabase: vi.fn(),
}));

vi.mock('../../../services/youtube.service', () => ({ uploadToYouTube: mockUploadToYouTube }));
vi.mock('../../../services/quota-manager.service', () => ({
  quotaManager: { preCheck: mockQuotaPreCheck, recordUsage: mockQuotaRecordUsage },
}));
vi.mock('../../../services/channel-limiter.service', () => ({
  channelLimiter: { check: mockChannelCheck, recordUpload: mockChannelRecordUpload },
}));
vi.mock('../../../services/youtube-fallback.service', () => ({
  activateFallback: vi.fn(),
  queueUploadForFallback: vi.fn(),
  isFallbackActive: vi.fn().mockResolvedValue(false),
  deactivateFallback: vi.fn(),
}));
vi.mock('../../../services/output-validation.service', () => ({
  OutputValidationGate: vi.fn().mockImplementation(function () {
    return {
      validateVideo: vi.fn().mockResolvedValue({ passed: true, checks: [], summary: 'ok' }),
    };
  }),
}));
vi.mock('fs', () => ({ existsSync: vi.fn().mockReturnValue(true) }));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('Upload Worker', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should process upload job successfully', async () => {
    const projectData = {
      id: 'project-1', title: 'Test Video', topic: 'test-topic',
      description: 'A test video', userId: 'user-1', channelId: 'channel-1',
      videoRender: { videoUrl: '/uploads/videos/test.mp4' },
      thumbnail: { imageUrl: '/uploads/thumbnails/test.jpg' },
      script: { content: 'Scene 1: test' },
    };

    mockPrismaFindUnique.mockResolvedValue(projectData);
    mockUploadToYouTube.mockResolvedValue('youtube-video-id');
    mockPrismaUpsert.mockResolvedValue({});
    mockPrismaVideoUpdate.mockResolvedValue({});
    mockQuotaPreCheck.mockResolvedValue({ canUpload: true, remaining: 10000, resetAt: new Date() });
    mockChannelCheck.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
    mockQuotaRecordUsage.mockResolvedValue(undefined);
    mockChannelRecordUpload.mockResolvedValue(undefined);

    const job = buildMockJob({
      id: 'upload-job-1',
      data: { projectId: 'project-1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    });

    await import('../../../workers/upload.worker');

    const processor = capturedProcessors['youtube-upload'];
    expect(processor).toBeDefined();

    const result = await processor(job);
    expect(result).toEqual({ videoId: 'youtube-video-id', fallback: false });
    expect(mockUploadToYouTube).toHaveBeenCalled();
    expect(mockQuotaRecordUsage).toHaveBeenCalledWith('channel-1');
    expect(mockChannelRecordUpload).toHaveBeenCalledWith('channel-1');
    expect(mockPrismaUpsert).toHaveBeenCalled();
  });

  it('should throw when no video render found', async () => {
    mockPrismaFindUnique.mockResolvedValue({ id: 'project-1', videoRender: null, thumbnail: null });

    const job = buildMockJob({
      id: 'upload-job-2',
      data: { projectId: 'project-1' },
      updateProgress: vi.fn().mockResolvedValue(undefined),
    });

    await import('../../../workers/upload.worker');
    const processor = capturedProcessors['youtube-upload'];

    await expect(processor(job)).rejects.toThrow('No rendered video found');
  });
});
