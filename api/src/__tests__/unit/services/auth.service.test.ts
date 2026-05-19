import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRedis = vi.hoisted((): Record<string, any> => {
  const f = () => vi.fn();
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    pexpire: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    hset: vi.fn().mockResolvedValue(1),
    hget: vi.fn().mockResolvedValue(null),
    hdel: vi.fn().mockResolvedValue(1),
    hgetall: vi.fn().mockResolvedValue({}),
    lpush: vi.fn().mockResolvedValue(1),
    lrange: vi.fn().mockResolvedValue([]),
    ltrim: vi.fn().mockResolvedValue('OK'),
    pttl: vi.fn().mockResolvedValue(-1),
    on: vi.fn().mockReturnThis(),
    multi: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]), set: vi.fn().mockReturnThis(), del: vi.fn().mockReturnThis() })),
    status: 'ready',
    quit: vi.fn().mockResolvedValue('OK'),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('ioredis', () => {
  function MockIORedis() { return mockRedis; }
  return { default: MockIORedis };
});

vi.mock('../../../utils/logger', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  aiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  queueLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  generateAccessToken, generateRefreshToken, generateTokenPair,
  verifyAccessToken, verifyRefreshToken,
  blacklistToken, isTokenBlacklisted, blacklistUserTokens,
  createSession, getUserSessions, removeSession, invalidateAllUserSessions,
  recordFailedLoginAttempt, isAccountLocked, clearLoginAttempts, getFailedLoginAttempts,
  detectSuspiciousLogin, rotateRefreshToken,
} from '../../../services/auth.service';

describe('Auth Service', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('generateAccessToken', () => {
    it('should generate a valid access token', () => {
      const r = generateAccessToken('user-1', 'user');
      expect(r.token).toBeTruthy();
      expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(verifyAccessToken(r.token).userId).toBe('user-1');
    });

    it('should produce unique tokens', () => {
      expect(generateAccessToken('user-1').token).not.toBe(generateAccessToken('user-1').token);
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a valid refresh token', () => {
      const r = generateRefreshToken('user-1');
      expect(r.token).toBeTruthy();
      expect(r.jti).toBeTruthy();
      expect(verifyRefreshToken(r.token).userId).toBe('user-1');
    });
  });

  describe('generateTokenPair', () => {
    it('should return both tokens', () => {
      const pair = generateTokenPair('user-1');
      expect(pair.token).toBeTruthy();
      expect(pair.refreshToken).toBeTruthy();
      expect(verifyAccessToken(pair.token).userId).toBe('user-1');
      expect(verifyRefreshToken(pair.refreshToken).userId).toBe('user-1');
    });
  });

  describe('verify', () => {
    it('should throw for invalid access token', () => {
      expect(() => verifyAccessToken('bad')).toThrow();
    });

    it('should throw for invalid refresh token', () => {
      expect(() => verifyRefreshToken('bad')).toThrow();
    });

    it('should throw for expired access token', () => {
      const jwt = require('jsonwebtoken');
      expect(() => verifyAccessToken(jwt.sign({ userId: 'u1', jti: 'x' }, process.env.JWT_SECRET!, { expiresIn: '0s' }))).toThrow('expired');
    });
  });

  describe('blacklist', () => {
    it('should blacklist a token', async () => {
      await blacklistToken('t1', 60000);
      expect(mockRedis.set).toHaveBeenCalledWith('blacklist:t1', '1', 'PX', 60000);
    });

    it('should detect blacklisted token', async () => {
      mockRedis.get.mockResolvedValue('1');
      expect(await isTokenBlacklisted('t1')).toBe(true);
    });

    it('should return false for non-blacklisted', async () => {
      mockRedis.get.mockResolvedValue(null);
      expect(await isTokenBlacklisted('t2')).toBe(false);
    });

    it('should return false on Redis error', async () => {
      mockRedis.get.mockRejectedValue(new Error('down'));
      expect(await isTokenBlacklisted('t3')).toBe(false);
    });
  });

  describe('sessions', () => {
    it('should create, get, remove sessions', async () => {
      await createSession('u1', 'j1', 't1', 'ip', 'ua');
      expect(mockRedis.hset).toHaveBeenCalled();
      const data = JSON.stringify({ jti: 'j1', createdAt: '', lastUsedAt: '', ip: '', userAgent: '', token: '' });
      mockRedis.hgetall.mockResolvedValue({ j1: data });
      expect(await getUserSessions('u1')).toHaveLength(1);
      mockRedis.hgetall.mockResolvedValue({});
      expect(await getUserSessions('u2')).toEqual([]);
      await removeSession('u1', 'j1');
      expect(mockRedis.hdel).toHaveBeenCalled();
    });

    it('should invalidate all sessions', async () => {
      await invalidateAllUserSessions('u1');
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });

  describe('brute force', () => {
    it('should record and detect lockout', async () => {
      await recordFailedLoginAttempt('e@e.com', 'ip');
      expect(mockRedis.incr).toHaveBeenCalled();
      mockRedis.incr.mockResolvedValue(5);
      await recordFailedLoginAttempt('e@e.com', 'ip');
      expect(mockRedis.set).toHaveBeenCalled();
      mockRedis.get.mockResolvedValue((Date.now() - 10000).toString());
      expect((await isAccountLocked('e@e.com')).locked).toBe(true);
      mockRedis.get.mockResolvedValue(null);
      expect((await isAccountLocked('e@e.com')).locked).toBe(false);
      await clearLoginAttempts('e@e.com');
      expect(mockRedis.del).toHaveBeenCalled();
      mockRedis.get.mockResolvedValue('3');
      expect(await getFailedLoginAttempts('e@e.com')).toBe(3);
    });
  });

  describe('suspicious login', () => {
    it('should not flag first login', async () => {
      expect((await detectSuspiciousLogin('u1', 'e@e.com', { ip: '1', userAgent: 'a' })).suspicious).toBe(false);
    });

    it('should flag new IP', async () => {
      mockRedis.lrange.mockResolvedValue(['1000:10.0.0.1']);
      const r = await detectSuspiciousLogin('u1', 'e@e.com', { ip: '10.0.0.2', userAgent: 'a' });
      expect(r.suspicious).toBe(true);
    });

    it('should flag excessive sessions', async () => {
      mockRedis.lrange.mockResolvedValue(['1000:10.0.0.1']);
      const s: Record<string, string> = {};
      for (let i = 0; i < 6; i++) s[`j${i}`] = JSON.stringify({ jti: '', createdAt: '', lastUsedAt: '', ip: '', userAgent: '', token: '' });
      mockRedis.hgetall.mockResolvedValue(s);
      expect((await detectSuspiciousLogin('u1', 'e@e.com', { ip: '10.0.0.1', userAgent: 'a' })).suspicious).toBe(true);
    });
  });

  describe('token rotation', () => {
    it('should rotate valid token', async () => {
      const { token, jti } = generateRefreshToken('user-1');
      const r = await rotateRefreshToken(token, 'user-1');
      expect(r.oldJti).toBe(jti);
      expect(r.tokenPair.token).toBeTruthy();
    });

    it('should throw for invalid token', async () => {
      await expect(rotateRefreshToken('bad', 'u1')).rejects.toThrow();
    });

    it('should throw on user mismatch', async () => {
      const { token } = generateRefreshToken('user-1');
      await expect(rotateRefreshToken(token, 'user-2')).rejects.toThrow('Refresh token user mismatch');
    });
  });
});
