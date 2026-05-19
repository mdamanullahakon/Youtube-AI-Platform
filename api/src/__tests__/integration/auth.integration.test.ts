import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPrismaUser } from '../helpers/factories';

const mockPrismaFindUnique = vi.hoisted(() => vi.fn());
const mockPrismaCreate = vi.hoisted(() => vi.fn());
const mockPrismaUpdate = vi.hoisted(() => vi.fn());
const mockPrismaSettingsCreate = vi.hoisted(() => vi.fn());
const mockPrismaSubscriptionCreate = vi.hoisted(() => vi.fn());
const mockBcryptHash = vi.hoisted(() => vi.fn());
const mockBcryptCompare = vi.hoisted(() => vi.fn());

vi.mock('ioredis', () => {
  function MockIORedis() {
    return {
      on: vi.fn().mockReturnThis(), get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1),
      incr: vi.fn().mockResolvedValue(1), pexpire: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1), hset: vi.fn().mockResolvedValue(1),
      hget: vi.fn().mockResolvedValue(null), hdel: vi.fn().mockResolvedValue(1),
      hgetall: vi.fn().mockResolvedValue({}), lpush: vi.fn().mockResolvedValue(1),
      lrange: vi.fn().mockResolvedValue([]), ltrim: vi.fn().mockResolvedValue('OK'),
      pttl: vi.fn().mockResolvedValue(-1), status: 'ready',
      multi: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      quit: vi.fn().mockResolvedValue('OK'),
    };
  }
  return { default: MockIORedis };
});

vi.mock('../../config/db', () => ({
  prisma: {
    user: { findUnique: mockPrismaFindUnique, create: mockPrismaCreate, update: mockPrismaUpdate },
    settings: { create: mockPrismaSettingsCreate },
    subscription: { create: mockPrismaSubscriptionCreate },
  },
  disconnectDatabase: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/email.service', () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('bcrypt', () => ({
  default: { hash: mockBcryptHash, compare: mockBcryptCompare },
  hash: mockBcryptHash,
  compare: mockBcryptCompare,
}));

import {
  register, login, refreshTokenHandler, logout, logoutAll,
  getSessions, revokeSession, forgotPassword, resetPassword, getProfile,
} from '../../controllers/auth.controller';
import { buildMockRequest, buildMockResponse } from '../helpers/factories';

describe('Auth Integration', () => {
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => { vi.clearAllMocks(); mockRes = buildMockResponse(); });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      mockReq = buildMockRequest({ body: { email: 'new@example.com', password: 'StrongPass1!', name: 'New User' } });
      mockPrismaFindUnique.mockResolvedValue(null);
      mockBcryptHash.mockResolvedValue('$2b$12$hashedPassword');
      mockPrismaCreate.mockResolvedValue(buildPrismaUser({ id: 'new-user-id', email: 'new@example.com', name: 'New User' }));
      mockPrismaSettingsCreate.mockResolvedValue({});
      mockPrismaSubscriptionCreate.mockResolvedValue({});

      await register(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json.mock.calls[0][0].success).toBe(true);
      expect(mockRes.json.mock.calls[0][0].token).toBeTruthy();
    });

    it('should return 400 for invalid input', async () => {
      mockReq = buildMockRequest({ body: { email: 'bad', password: 'weak' } });
      await register(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 409 for duplicate email', async () => {
      mockReq = buildMockRequest({ body: { email: 'dup@example.com', password: 'StrongPass1!' } });
      mockPrismaFindUnique.mockResolvedValue(buildPrismaUser({ email: 'dup@example.com' }));
      await register(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(409);
    });

    it('should return 500 on unexpected error', async () => {
      mockReq = buildMockRequest({ body: { email: 'new@example.com', password: 'StrongPass1!' } });
      mockPrismaFindUnique.mockRejectedValue(new Error('db crash'));
      await register(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('login', () => {
    it('should login successfully', async () => {
      mockReq = buildMockRequest({ body: { email: 'test@example.com', password: 'CorrectPass1!' } });
      mockPrismaFindUnique.mockResolvedValue(buildPrismaUser());
      mockBcryptCompare.mockResolvedValue(true);

      await login(mockReq, mockRes);
      expect(mockRes.json.mock.calls[0][0].success).toBe(true);
      expect(mockRes.json.mock.calls[0][0].token).toBeTruthy();
    });

    it('should return 400 for invalid input', async () => {
      mockReq = buildMockRequest({ body: { email: 'bad' } });
      await login(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 401 for wrong email', async () => {
      mockReq = buildMockRequest({ body: { email: 'wrong@example.com', password: 'AnyPass1!' } });
      mockPrismaFindUnique.mockResolvedValue(null);
      await login(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should return 401 for wrong password', async () => {
      mockReq = buildMockRequest({ body: { email: 'test@example.com', password: 'WrongPass1!' } });
      mockPrismaFindUnique.mockResolvedValue(buildPrismaUser());
      mockBcryptCompare.mockResolvedValue(false);
      await login(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });

  describe('refreshTokenHandler', () => {
    it('should return 400 when no refresh token', async () => {
      mockReq = buildMockRequest({ body: {} });
      await refreshTokenHandler(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return 401 for invalid refresh token', async () => {
      mockReq = buildMockRequest({ body: { refreshToken: 'bad-token' } });
      await refreshTokenHandler(mockReq, mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });

  describe('forgotPassword', () => {
    it('should send reset email for existing user', async () => {
      mockReq = buildMockRequest({ body: { email: 'test@example.com' } });
      mockPrismaFindUnique.mockResolvedValue(buildPrismaUser());
      await forgotPassword(mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should not reveal non-existing user', async () => {
      mockReq = buildMockRequest({ body: { email: 'nonexistent@example.com' } });
      mockPrismaFindUnique.mockResolvedValue(null);
      await forgotPassword(mockReq, mockRes);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
  });

  describe('Protected routes', () => {
    it('getSessions requires auth', async () => {
      await getSessions(buildMockRequest({}), mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('logoutAll requires auth', async () => {
      await logoutAll(buildMockRequest({}), mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('getProfile 404 when unauthenticated', async () => {
      await getProfile(buildMockRequest({}), mockRes);
      expect(mockRes.status).toHaveBeenCalledWith(404);
    });
  });
});
