import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ioredis', () => {
  function MockIORedis() {
    const self: Record<string, any> = {
      on: vi.fn().mockReturnThis(),
      incr: vi.fn().mockResolvedValue(1),
      pexpire: vi.fn().mockResolvedValue(1),
      pttl: vi.fn().mockResolvedValue(60000),
      get: vi.fn().mockResolvedValue(null),
      status: 'ready',
      quit: vi.fn().mockResolvedValue('OK'),
    };
    return self;
  }
  return { default: MockIORedis };
});

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { redisRateLimiter, validateApiKey, securityHeaders, validateTokenBlacklist } from '../../../services/security.service';

describe('Security Service', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReq = { ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, path: '/api/test', headers: {} };
    mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn().mockReturnThis() };
    mockNext = vi.fn();
  });

  describe('redisRateLimiter', () => {
    it('should allow requests within limit', async () => {
      await redisRateLimiter(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 60);
    });

    it('should apply stricter limit for auth routes', async () => {
      mockReq.path = '/api/auth/login';
      await redisRateLimiter(mockReq, mockRes, mockNext);
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    });

    it('should allow request on Redis error', async () => {
      const ioredis = await import('ioredis');
      const MockIORedis = ioredis.default;
      const instance = new (MockIORedis as any)();
      instance.incr = vi.fn().mockRejectedValue(new Error('redis down'));

      const { redisRateLimiter: rl } = await import('../../../services/security.service');
      await rl(mockReq, mockRes, mockNext);
      // The rate limiter catches errors and calls next()
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('securityHeaders', () => {
    it('should set all security headers', () => {
      securityHeaders(mockReq, mockRes, mockNext);
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(mockRes.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Strict-Transport-Security', expect.any(String));
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('validateApiKey', () => {
    it('should pass through for non-external routes', () => {
      validateApiKey(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('validateTokenBlacklist', () => {
    it('should pass through when no auth header', async () => {
      await validateTokenBlacklist(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
