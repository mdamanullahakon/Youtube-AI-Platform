import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ioredis', () => {
  function MockIORedis() {
    return {
      on: vi.fn().mockReturnThis(), get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1),
      hset: vi.fn().mockResolvedValue(1), hdel: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1), status: 'ready',
      quit: vi.fn().mockResolvedValue('OK'),
    };
  }
  return { default: MockIORedis };
});

vi.mock('../../../utils/logger', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { authenticate, optionalAuth, requireRole } from '../../../middleware/auth';

describe('Auth Middleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReq = { headers: {}, cookies: {}, get: vi.fn() };
    mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    mockNext = vi.fn();
  });

  describe('authenticate', () => {
    it('should return 401 when no token provided', async () => {
      await authenticate(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should authenticate with Bearer token (real auth service)', async () => {
      const { generateAccessToken } = await import('../../../services/auth.service');
      const { token } = generateAccessToken('user-1', 'admin');
      mockReq.headers.authorization = `Bearer ${token}`;

      await authenticate(mockReq, mockRes, mockNext);
      expect(mockReq.userId).toBe('user-1');
      expect(mockReq.userRole).toBe('admin');
      expect(mockReq.tokenJti).toBeTruthy();
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should authenticate with cookie token', async () => {
      const { generateAccessToken } = await import('../../../services/auth.service');
      const { token } = generateAccessToken('user-2', 'user');
      mockReq.cookies.token = token;

      await authenticate(mockReq, mockRes, mockNext);
      expect(mockReq.userId).toBe('user-2');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should authenticate with x-access-token header', async () => {
      const { generateAccessToken } = await import('../../../services/auth.service');
      const { token } = generateAccessToken('user-3', 'user');
      mockReq.headers['x-access-token'] = token;

      await authenticate(mockReq, mockRes, mockNext);
      expect(mockReq.userId).toBe('user-3');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should return 401 when token is expired', async () => {
      const jwt = require('jsonwebtoken');
      const expired = jwt.sign({ userId: 'u1', jti: 'jti1', role: 'user' }, process.env.JWT_SECRET!, { expiresIn: '0s' });
      mockReq.headers.authorization = `Bearer ${expired}`;

      await authenticate(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_EXPIRED' }));
    });

    it('should return 401 for invalid token', async () => {
      mockReq.headers.authorization = 'Bearer absolutely-invalid-token';
      await authenticate(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });

  describe('optionalAuth', () => {
    it('should continue without auth', () => {
      optionalAuth(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should attach user when valid token', async () => {
      const { generateAccessToken } = await import('../../../services/auth.service');
      const { token } = generateAccessToken('user-1', 'user');
      mockReq.headers.authorization = `Bearer ${token}`;

      optionalAuth(mockReq, mockRes, mockNext);
      expect(mockReq.userId).toBe('user-1');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should silently continue on invalid token', () => {
      mockReq.headers.authorization = 'Bearer bad-token';
      optionalAuth(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.userId).toBeUndefined();
    });
  });

  describe('requireRole', () => {
    it('should 401 if not authenticated', () => {
      requireRole('admin')(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should 403 if role not authorized', () => {
      mockReq.userId = 'u1';
      mockReq.userRole = 'user';
      requireRole('admin')(mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should allow matching role', () => {
      mockReq.userId = 'u1';
      mockReq.userRole = 'admin';
      requireRole('admin')(mockReq, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
