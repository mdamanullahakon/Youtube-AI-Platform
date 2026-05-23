import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, isTokenBlacklisted, updateSessionLastUsed } from '../services/auth.service';
import { apiLogger } from '../utils/logger';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  tokenJti?: string;
  token?: string;
}

function extractToken(req: AuthRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  if (req.cookies?.token) {
    return req.cookies.token;
  }

  if (req.headers['x-access-token']) {
    return req.headers['x-access-token'] as string;
  }

  return null;
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (err: any) {
      apiLogger.warn('Token validation failed', { error: err?.message || String(err) });
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const blacklisted = await isTokenBlacklisted(token);
    if (blacklisted) {
      return res.status(401).json({ success: false, message: 'Token has been revoked', code: 'TOKEN_REVOKED' });
    }

    req.userId = payload.userId;
    req.userRole = payload.role;
    req.tokenJti = payload.jti;
    req.token = token;

    updateSessionLastUsed(payload.userId, payload.jti).catch(() => {});

    next();
  } catch (err: any) {
    apiLogger.error('Auth middleware error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Authentication service unavailable' });
  }
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.userId;
    req.userRole = payload.role;
  } catch {
    // Token invalid, continue without auth
  }
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    if (roles.length > 0 && (!req.userRole || !roles.includes(req.userRole))) {
      return res.status(403).json({ success: false, message: 'Insufficient permissions' });
    }
    next();
  };
}