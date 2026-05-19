import { vi } from 'vitest';
import type { DeepMockProxy } from 'vitest-mock-extended';
import { mockDeep } from 'vitest-mock-extended';

// Global store for accessing the last registered worker processor
export const workerProcessors: Record<string, Function> = {};

// ─── Redis ─────────────────────────────────────────
export function mockIORedis() {
  vi.mock('ioredis', () => {
    function MockIORedis() {
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
        incrby: vi.fn().mockResolvedValue(1),
        expire: vi.fn().mockResolvedValue(1),
        pexpire: vi.fn().mockResolvedValue(1),
        pttl: vi.fn().mockResolvedValue(-1),
        ttl: vi.fn().mockResolvedValue(-1),
        hset: vi.fn().mockResolvedValue(1),
        hget: vi.fn().mockResolvedValue(null),
        hdel: vi.fn().mockResolvedValue(1),
        hgetall: vi.fn().mockResolvedValue({}),
        lpush: vi.fn().mockResolvedValue(1),
        lrange: vi.fn().mockResolvedValue([]),
        ltrim: vi.fn().mockResolvedValue('OK'),
        keys: vi.fn().mockResolvedValue([]),
        multi: vi.fn(() => ({
          exec: vi.fn().mockResolvedValue([]),
          set: vi.fn().mockReturnThis(),
          del: vi.fn().mockReturnThis(),
          expire: vi.fn().mockReturnThis(),
          incr: vi.fn().mockReturnThis(),
        })),
        status: 'ready',
      };
      return self;
    }
    return { default: MockIORedis };
  });
}

// ─── BullMQ ────────────────────────────────────────
export function mockBullMQ() {
  vi.mock('bullmq', () => {
    function Worker(queueName: string, processor: Function, opts?: any) {
      workerProcessors[queueName] = processor;
      return {
        name: queueName,
        processor,
        opts,
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
      };
    }
    function Queue(name: string, opts?: any) {
      return {
        name, opts,
        add: vi.fn().mockResolvedValue({ id: 'mock-job-id', data: {} }),
        getJob: vi.fn().mockResolvedValue(null),
        getJobs: vi.fn().mockResolvedValue([]),
        obliterate: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
    }
    function QueueEvents(name: string, opts?: any) {
      return { name, opts, on: vi.fn().mockReturnThis(), close: vi.fn().mockResolvedValue(undefined) };
    }
    function FlowProducer(opts?: any) {
      return {
        opts, add: vi.fn().mockResolvedValue({ job: { id: 'mock-flow-job' } }),
        getFlow: vi.fn().mockResolvedValue(null), close: vi.fn().mockResolvedValue(undefined),
      };
    }
    return { Worker, Queue, QueueEvents, FlowProducer };
  });
}

// ─── Prisma ────────────────────────────────────────
export function mockPrismaClient(): void {
  vi.mock('../../config/db', () => ({
    prisma: mockDeep<typeof import('@prisma/client').PrismaClient>(),
    disconnectDatabase: vi.fn(),
  }));
}

// ─── Logger ────────────────────────────────────────
export function mockLogger(): void {
  vi.mock('../../utils/logger', () => ({
    apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    aiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    queueLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  }));
}

// ─── Email Service ─────────────────────────────────
export function mockEmailService(): void {
  vi.mock('../../services/email.service', () => ({
    sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  }));
}

// ─── All External (call at top of test files) ─────
export function mockAllExternal(): void {
  mockIORedis();
  mockBullMQ();
  mockLogger();
}
