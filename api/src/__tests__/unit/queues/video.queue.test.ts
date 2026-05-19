import { describe, it, expect, vi } from 'vitest';

vi.mock('ioredis', () => {
  function MockIORedis() {
    return { on: vi.fn().mockReturnThis(), status: 'ready', quit: vi.fn().mockResolvedValue('OK') };
  }
  return { default: MockIORedis };
});

vi.mock('bullmq', () => {
  function MockQueue(this: any, name: string) {
    this.name = name;
    this.on = vi.fn().mockReturnThis();
    this.add = vi.fn().mockResolvedValue({ id: 'mock-id', data: {} });
    this.getJob = vi.fn();
    this.close = vi.fn().mockResolvedValue(undefined);
    return this;
  }
  function MockQueueEvents(this: any, name: string) {
    this.name = name;
    this.on = vi.fn().mockReturnThis();
    this.close = vi.fn().mockResolvedValue(undefined);
  }
  return { Queue: MockQueue as any, QueueEvents: MockQueueEvents as any };
});

import {
  STANDARD_JOB_OPTS, RENDER_JOB_OPTS, UPLOAD_JOB_OPTS, CLEANUP_JOB_OPTS,
  DLQ_NAMES, ALL_QUEUES, queueMap, eventMap, dlqMap,
} from '../../../queues/video.queue';

describe('Video Queue Configuration', () => {
  describe('STANDARD_JOB_OPTS', () => {
    it('should have 3 attempts, exponential backoff, 180s timeout', () => {
      expect(STANDARD_JOB_OPTS.attempts).toBe(3);
      expect(STANDARD_JOB_OPTS.backoff).toEqual({ type: 'exponential', delay: 2000 });
      expect(STANDARD_JOB_OPTS.timeout).toBe(180_000);
    });
  });

  describe('RENDER_JOB_OPTS', () => {
    it('should have 5 attempts, 5s backoff, 600s timeout', () => {
      expect(RENDER_JOB_OPTS.attempts).toBe(5);
      expect(RENDER_JOB_OPTS.backoff.delay).toBe(5000);
      expect(RENDER_JOB_OPTS.timeout).toBe(600_000);
    });
  });

  describe('UPLOAD_JOB_OPTS', () => {
    it('should have 5 attempts, 10s backoff, 300s timeout', () => {
      expect(UPLOAD_JOB_OPTS.attempts).toBe(5);
      expect(UPLOAD_JOB_OPTS.timeout).toBe(300_000);
    });
  });

  describe('CLEANUP_JOB_OPTS', () => {
    it('should have 2 attempts', () => {
      expect(CLEANUP_JOB_OPTS.attempts).toBe(2);
    });
  });

  describe('DLQ_NAMES', () => {
    it('should have DLQ suffix for all', () => {
      for (const key of Object.keys(DLQ_NAMES) as (keyof typeof DLQ_NAMES)[]) {
        expect(DLQ_NAMES[key]).toContain('-dlq');
      }
    });
  });

  describe('ALL_QUEUES', () => {
    it('should have 8 entries with expected names', () => {
      expect(ALL_QUEUES).toHaveLength(8);
      const names = ALL_QUEUES.map(q => q.name);
      expect(names).toContain('video-generation');
      expect(names).toContain('trend-analysis');
      expect(names).toContain('script-generation');
      expect(names).toContain('agent-tasks');
      expect(names).toContain('video-render');
      expect(names).toContain('youtube-upload');
      expect(names).toContain('analytics-collection');
      expect(names).toContain('transcript-analysis');
    });
  });

  describe('lookup maps', () => {
    it('queueMap should have keys', () => {
      expect(queueMap['trend-analysis']).toBeDefined();
      expect(queueMap['youtube-upload']).toBeDefined();
    });

    it('eventMap should have keys', () => {
      expect(eventMap['trend-analysis']).toBeDefined();
    });

    it('dlqMap should have keys', () => {
      expect(dlqMap['trend-analysis']).toBeDefined();
      expect(dlqMap['prompt-generation']).toBeDefined();
    });
  });
});
