import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFlowAdd = vi.hoisted(() => vi.fn());
const mockFlowGet = vi.hoisted(() => vi.fn());
const mockPrismaUpdate = vi.hoisted(() => vi.fn());

vi.mock('ioredis', () => {
  function MockIORedis() { return { on: vi.fn().mockReturnThis(), status: 'ready', quit: vi.fn().mockResolvedValue('OK') }; }
  return { default: MockIORedis };
});

vi.mock('../../../utils/logger', () => ({
  queueLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../config/db', () => ({
  prisma: { videoProject: { update: mockPrismaUpdate } },
  disconnectDatabase: vi.fn(),
}));

vi.mock('bullmq', () => {
  function FlowProducer() { return { add: mockFlowAdd, getFlow: mockFlowGet, close: vi.fn().mockResolvedValue(undefined) }; }
  function Queue(name = 'mock', opts?: any) {
    return { name, opts, add: vi.fn().mockResolvedValue({ id: 'mock-job' }), close: vi.fn().mockResolvedValue(undefined) };
  }
  function QueueEvents(name: string, opts?: any) {
    return { name, opts, on: vi.fn().mockReturnThis(), close: vi.fn().mockResolvedValue(undefined) };
  }
  return { FlowProducer, Queue, QueueEvents };
});

import { createFullPipelineFlow, createScriptToRenderFlow, getPipelineTreeStatus } from '../../../queues/pipeline.queue';

describe('Pipeline Queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_LEGACY_QUEUE_PIPELINE = 'true';
  });

  describe('createFullPipelineFlow', () => {
    it('should create a pipeline and update project status', async () => {
      mockFlowAdd.mockResolvedValue({ job: { id: 'root-job-id' } });
      mockPrismaUpdate.mockResolvedValue({});

      const result = await createFullPipelineFlow('project-1', 'test-topic');
      expect(result.pipelineJobId).toBe('root-job-id');
      expect(mockPrismaUpdate).toHaveBeenCalled();
      expect(mockPrismaUpdate.mock.calls[0][0].where.id).toBe('project-1');
      expect(mockPrismaUpdate.mock.calls[0][0].data.status).toBe('running');
    });

    it('should build correct tree structure', async () => {
      mockFlowAdd.mockResolvedValue({ job: { id: 'root-job-id' } });
      mockPrismaUpdate.mockResolvedValue({});
      await createFullPipelineFlow('project-1', 'test-topic');
      const tree = mockFlowAdd.mock.calls[0][0];
      expect(tree.name).toBe('collect-analytics');
      // root -> cleanup-assets -> upload-video -> render-video -> script-generation -> trend-analysis
      expect(tree.children[0].name).toBe('cleanup-assets');
      expect(tree.children[0].children[0].name).toBe('upload-video');
      expect(tree.children[0].children[0].children[0].name).toBe('render-video');
      expect(tree.children[0].children[0].children[0].children[0].name).toBe('script-generation');
      expect(tree.children[0].children[0].children[0].children[0].children[0].name).toBe('trend-analysis');
    });

    it('should not fail when project update fails', async () => {
      mockFlowAdd.mockResolvedValue({ job: { id: 'root-job-id' } });
      mockPrismaUpdate.mockRejectedValue(new Error('db error'));
      await expect(createFullPipelineFlow('project-1', 'test-topic')).resolves.toBeDefined();
    });
  });

  describe('createScriptToRenderFlow', () => {
    it('should create a shorter pipeline', async () => {
      mockFlowAdd.mockResolvedValue({ job: { id: 'sr-job' } });
      const result = await createScriptToRenderFlow('project-1');
      expect(result.pipelineJobId).toBe('sr-job');
      const tree = mockFlowAdd.mock.calls[0][0];
      // root -> cleanup-assets -> upload-video -> render-video
      expect(tree.children[0].children[0].children[0].name).toBe('render-video');
      expect(tree.children[0].children[0].children[0].children).toBeUndefined();
    });
  });

  describe('getPipelineTreeStatus', () => {
    it('should return tree or null', async () => {
      mockFlowGet.mockResolvedValue({ id: 'root', status: 'completed' });
      expect(await getPipelineTreeStatus('root')).toEqual({ id: 'root', status: 'completed' });
      mockFlowGet.mockRejectedValue(new Error('not found'));
      expect(await getPipelineTreeStatus('x')).toBeNull();
    });
  });
});
