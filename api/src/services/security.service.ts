import { Request, Response, NextFunction } from 'express';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 60;
const AUTH_MAX_REQUESTS = 10;

export async function redisRateLimiter(req: Request, res: Response, next: NextFunction) {
  try {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const isAuth = req.path.startsWith('/api/auth/');
    const maxReqs = isAuth ? AUTH_MAX_REQUESTS : MAX_REQUESTS_PER_WINDOW;
    const key = `ratelimit:${ip}:${isAuth ? 'auth' : 'api'}`;

    const current = await redisConnection.incr(key);
    if (current === 1) {
      await redisConnection.pexpire(key, WINDOW_MS);
    }

    const ttl = await redisConnection.pttl(key);

    res.setHeader('X-RateLimit-Limit', maxReqs);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxReqs - current));
    res.setHeader('X-RateLimit-Reset', Date.now() + ttl);

    if (current > maxReqs) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please try again later.',
        retryAfter: Math.ceil(ttl / 1000),
      });
    }

    next();
  } catch (err) {
    logger.warn('Rate limiter error, allowing request', { error: (err as Error).message });
    next();
  }
}

export function validateApiKey(req: Request, _res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const expectedKey = process.env.API_KEY;

  if (expectedKey && req.path.startsWith('/api/external/')) {
    if (apiKey !== expectedKey) {
      return _res.status(401).json({ success: false, message: 'Invalid API key' });
    }
  }
  next();
}

export function validateContentType(req: Request, res: Response, next: NextFunction) {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('multipart/form-data')) {
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      next();
      return;
    }
  }
  next();
}

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

export async function validateTokenBlacklist(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const isBlacklisted = await redisConnection.get(`blacklist:${token}`);
      if (isBlacklisted) {
        return _res.status(401).json({ success: false, message: 'Token has been revoked' });
      }
    } catch {
      // Redis unavailable, skip check
    }
  }
  next();
}
