import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPrismaUser } from '../helpers/factories';

const mockPrismaFindUnique = vi.hoisted(() => vi.fn());
const mockPrismaCreate = vi.hoisted(() => vi.fn());
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
    user: { findUnique: mockPrismaFindUnique, create: mockPrismaCreate },
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

vi.mock('../../middleware/rateLimiter', () => ({
  rateLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/security.service', () => ({
  redisRateLimiter: (_req: any, _res: any, next: any) => next(),
  securityHeaders: (_req: any, _res: any, next: any) => next(),
  validateApiKey: (_req: any, _res: any, next: any) => next(),
}));

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import authRoutes from '../../routes/auth.routes';
import { errorHandler } from '../../middleware/errorHandler';

function createApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use(errorHandler);
  return app;
}

describe('Auth API (HTTP)', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  describe('POST /api/auth/register', () => {
    it('should return 201 for valid registration', async () => {
      mockPrismaFindUnique.mockResolvedValue(null);
      mockBcryptHash.mockResolvedValue('$2b$12$hashed');
      mockPrismaCreate.mockResolvedValue(buildPrismaUser({ id: 'new-id', email: 'newuser@example.com', name: 'New User' }));
      mockPrismaSettingsCreate.mockResolvedValue({});
      mockPrismaSubscriptionCreate.mockResolvedValue({});

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'newuser@example.com', password: 'StrongPass1!', name: 'New User' })
        .expect(201);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
    });

    it('should return 400 for invalid payload', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'bad', password: 'weak' })
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 409 for duplicate email', async () => {
      mockPrismaFindUnique.mockResolvedValue(buildPrismaUser({ email: 'dup@example.com' }));
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'dup@example.com', password: 'StrongPass1!' })
        .expect(409);
      expect(res.body.message).toContain('already registered');
    });
  });

  describe('POST /api/auth/login', () => {
    it('should return 200 for valid credentials', async () => {
      mockPrismaFindUnique.mockResolvedValue(buildPrismaUser());
      mockBcryptCompare.mockResolvedValue(true);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'CorrectPass1!' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeTruthy();
    });

    it('should return 400 for missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({})
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 401 for wrong credentials', async () => {
      mockPrismaFindUnique.mockResolvedValue(null);
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'wrong@example.com', password: 'WrongPass1!' })
        .expect(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should return 400 when no refresh token', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({})
        .expect(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 401 for invalid refresh token', async () => {
      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('should return 200 (prevents email enumeration)', async () => {
      mockPrismaFindUnique.mockResolvedValue(null);
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' })
        .expect(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Protected Routes', () => {
    it('should return 401 for profile without token', async () => {
      await request(app).get('/api/auth/profile').expect(401);
    });

    it('should return 401 for sessions without token', async () => {
      await request(app).get('/api/auth/sessions').expect(401);
    });

    it('should return 401 for logout without token', async () => {
      await request(app).post('/api/auth/logout').expect(401);
    });
  });
});
