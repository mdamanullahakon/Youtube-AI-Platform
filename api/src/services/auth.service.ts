import jwt, { type SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import { env } from '../config/env';
import { redisConnection } from '../config/redis';
import { prisma } from '../config/db';
import { apiLogger } from '../utils/logger';

const ACCESS_TOKEN_TTL_MS = msFromString(env.JWT_EXPIRES_IN);
const REFRESH_TOKEN_TTL_MS = msFromString(env.JWT_REFRESH_EXPIRES_IN);

function msFromString(str: string): number {
  const match = str.match(/^(\d+)\s*(s|m|h|d)$/);
  if (!match) return 15 * 60 * 1000;
  const num = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    case 'h': return num * 3600 * 1000;
    case 'd': return num * 86400 * 1000;
    default: return 15 * 60 * 1000;
  }
}

function getExpiresAt(ttlMs: number): Date {
  return new Date(Date.now() + ttlMs);
}

export interface TokenPair {
  token: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface JwtPayload {
  userId: string;
  jti: string;
  role?: string;
}

// ─── Token Generation ────────────────────────────

export function generateAccessToken(userId: string, role?: string): { token: string; expiresAt: Date } {
  const jti = uuidv4();
  const expiresAt = getExpiresAt(ACCESS_TOKEN_TTL_MS);
  const token = jwt.sign(
    { userId, jti, role } satisfies JwtPayload,
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'], issuer: env.JWT_ISSUER },
  );
  return { token, expiresAt };
}

export function generateRefreshToken(userId: string): { token: string; jti: string; expiresAt: Date } {
  const jti = uuidv4();
  const expiresAt = getExpiresAt(REFRESH_TOKEN_TTL_MS);
  const token = jwt.sign(
    { userId, jti } satisfies JwtPayload,
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'], issuer: env.JWT_ISSUER },
  );
  return { token, jti, expiresAt };
}

export function generateTokenPair(userId: string, role?: string): TokenPair {
  const access = generateAccessToken(userId, role);
  const refresh = generateRefreshToken(userId);
  return { token: access.token, refreshToken: refresh.token, expiresAt: access.expiresAt };
}

// ─── Token Verification ──────────────────────────

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET, { issuer: env.JWT_ISSUER }) as JwtPayload;
}

export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer: env.JWT_ISSUER }) as JwtPayload;
}

// ─── Token Blacklist ─────────────────────────────

export async function blacklistToken(token: string, ttlMs: number): Promise<void> {
  const key = `blacklist:${token}`;
  await redisConnection.set(key, '1', 'PX', ttlMs);
}

export async function isTokenBlacklisted(token: string): Promise<boolean> {
  try {
    const result = await redisConnection.get(`blacklist:${token}`);
    return result === '1';
  } catch {
    return false;
  }
}

export async function blacklistUserTokens(userId: string): Promise<void> {
  const key = `user-blacklist:${userId}`;
  await redisConnection.set(key, Date.now().toString(), 'PX', REFRESH_TOKEN_TTL_MS);
}

export async function areUserTokensBlacklisted(userId: string, tokenJti: string): Promise<boolean> {
  try {
    const blacklistedSince = await redisConnection.get(`user-blacklist:${userId}`);
    if (!blacklistedSince) return false;
    const decoded = jwt.decode(tokenJti) as any;
    const tokenIat = decoded?.iat ? decoded.iat * 1000 : 0;
    return tokenIat < parseInt(blacklistedSince, 10);
  } catch {
    return false;
  }
}

// ─── Session Management ──────────────────────────

export interface SessionInfo {
  jti: string;
  createdAt: string;
  lastUsedAt: string;
  ip: string;
  userAgent: string;
  token: string;
}

export async function createSession(
  userId: string,
  tokenJti: string,
  token: string,
  ip: string,
  userAgent: string,
): Promise<void> {
  const session: SessionInfo = {
    jti: tokenJti,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    ip,
    userAgent,
    token,
  };
  await redisConnection.hset(`sessions:${userId}`, tokenJti, JSON.stringify(session));
  await redisConnection.expire(`sessions:${userId}`, Math.ceil(REFRESH_TOKEN_TTL_MS / 1000));
}

export async function updateSessionLastUsed(userId: string, jti: string): Promise<void> {
  const data = await redisConnection.hget(`sessions:${userId}`, jti);
  if (data) {
    const session: SessionInfo = JSON.parse(data);
    session.lastUsedAt = new Date().toISOString();
    await redisConnection.hset(`sessions:${userId}`, jti, JSON.stringify(session));
  }
}

export async function removeSession(userId: string, jti: string): Promise<void> {
  await redisConnection.hdel(`sessions:${userId}`, jti);
}

export async function getUserSessions(userId: string): Promise<SessionInfo[]> {
  const data = await redisConnection.hgetall(`sessions:${userId}`);
  if (!data) return [];
  return Object.values(data).map((v) => JSON.parse(v));
}

export async function invalidateAllUserSessions(userId: string): Promise<void> {
  await redisConnection.del(`sessions:${userId}`);
  await blacklistUserTokens(userId);
}

// ─── Brute Force Protection ──────────────────────

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export async function isAccountLocked(email: string): Promise<{ locked: boolean; remainingMs: number }> {
  const lockoutData = await redisConnection.get(`lockout:${email}`);
  if (!lockoutData) return { locked: false, remainingMs: 0 };
  const parts = lockoutData.split(':');
  const lockoutTime = parseInt(parts[0], 10);
  const lockoutDuration = parts.length > 1 ? parseInt(parts[1], 10) : 60000;
  const elapsed = Date.now() - lockoutTime;
  const remaining = lockoutDuration - elapsed;
  if (remaining <= 0) {
    await redisConnection.del(`lockout:${email}`);
    return { locked: false, remainingMs: 0 };
  }
  return { locked: true, remainingMs: remaining };
}

export async function recordFailedLoginAttempt(email: string, ip: string): Promise<void> {
  const key = `login-attempts:${email}`;
  const attempts = await redisConnection.incr(key);
  if (attempts === 1) {
    await redisConnection.pexpire(key, LOCKOUT_WINDOW_MS);
  }

  const ipKey = `login-ips:${email}`;
  await redisConnection.lpush(ipKey, `${Date.now()}:${ip}`);
  await redisConnection.ltrim(ipKey, 0, 49);
  await redisConnection.expire(ipKey, 86400);

  if (attempts >= MAX_LOGIN_ATTEMPTS) {
    const lockoutDuration = Math.min(Math.pow(2, attempts - MAX_LOGIN_ATTEMPTS) * 60 * 1000, 3600 * 1000);
    await redisConnection.set(`lockout:${email}`, `${Date.now()}:${lockoutDuration}`, 'PX', lockoutDuration);
    apiLogger.warn(`Account locked due to failed attempts`, { email, attempts, lockoutMs: lockoutDuration });
  }
}

export async function clearLoginAttempts(email: string): Promise<void> {
  await redisConnection.del(`login-attempts:${email}`);
  await redisConnection.del(`lockout:${email}`);
}

export async function getFailedLoginAttempts(email: string): Promise<number> {
  const val = await redisConnection.get(`login-attempts:${email}`);
  return val ? parseInt(val, 10) : 0;
}

// ─── Suspicious Login Detection ──────────────────

export interface LoginContext {
  ip: string;
  userAgent: string;
  city?: string;
  country?: string;
}

export async function detectSuspiciousLogin(
  userId: string,
  email: string,
  context: LoginContext,
): Promise<{ suspicious: boolean; reason?: string }> {
  const knownIps = await redisConnection.lrange(`login-ips:${email}`, 0, -1);
  if (knownIps.length === 0) return { suspicious: false };

  const recentIps = knownIps.map((entry) => entry.split(':')[1]).filter(Boolean);
  const uniqueRecentIps = [...new Set(recentIps)];

  if (uniqueRecentIps.length > 0 && !uniqueRecentIps.includes(context.ip)) {
    apiLogger.warn(`Suspicious login detected`, {
      userId,
      email,
      currentIp: context.ip,
      knownIps: uniqueRecentIps,
      userAgent: context.userAgent,
    });
    return { suspicious: true, reason: 'Login from new IP address' };
  }

  const sessions = await getUserSessions(userId);
  if (sessions.length > 5) {
    return { suspicious: true, reason: 'Excessive active sessions' };
  }

  return { suspicious: false };
}

// ─── Refresh Token Rotation ──────────────────────

export async function rotateRefreshToken(
  oldRefreshToken: string,
  userId: string,
  role?: string,
): Promise<{ tokenPair: TokenPair; oldJti: string }> {
  let oldPayload: JwtPayload;
  try {
    oldPayload = verifyRefreshToken(oldRefreshToken);
  } catch {
    throw new Error('Invalid refresh token');
  }

  if (oldPayload.userId !== userId) {
    throw new Error('Refresh token user mismatch');
  }

  const oldJti = oldPayload.jti;

  await blacklistToken(oldRefreshToken, REFRESH_TOKEN_TTL_MS);
  await removeSession(userId, oldJti);

  const tokenPair = generateTokenPair(userId, role);

  return { tokenPair, oldJti };
}
