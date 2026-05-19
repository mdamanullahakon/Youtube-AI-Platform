import { Request, Response, NextFunction } from 'express';
import { apiLogger } from '../utils/logger';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export function createCsrfMiddleware(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.includes(req.method)) {
      return next();
    }

    const cookieToken = req.cookies?.token;
    if (!cookieToken) {
      return next();
    }

    const origin = req.headers.origin as string | undefined;
    const referer = req.headers.referer as string | undefined;

    if (origin) {
      if (allowedOrigins.includes(origin)) {
        return next();
      }
      apiLogger.warn('CSRF: invalid origin', { origin, method: req.method, path: req.path });
      return res.status(403).json({ success: false, message: 'CSRF validation failed' });
    }

    if (referer) {
      try {
        const refUrl = new URL(referer);
        if (allowedOrigins.includes(refUrl.origin)) {
          return next();
        }
      } catch {
        return res.status(403).json({ success: false, message: 'CSRF validation failed' });
      }
      return res.status(403).json({ success: false, message: 'CSRF validation failed' });
    }

    if (req.headers.authorization?.startsWith('Bearer ')) {
      return next();
    }

    return res.status(403).json({ success: false, message: 'CSRF validation failed' });
  };
}
