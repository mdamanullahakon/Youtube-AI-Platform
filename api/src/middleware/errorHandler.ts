import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { ZodError } from 'zod';
import { ErrorFixerService } from '../services/error-fixer.service';

const OAUTH_CALLBACK_PATH = '/api/auth/youtube/callback';

function getPrimaryFrontendUrl(): string {
  const raw = process.env.FRONTEND_URL || 'http://localhost:3000';
  return raw.split(',')[0].trim();
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  // If the OAuth callback crashes, always redirect to frontend (never show JSON/error in browser)
  if (req.originalUrl?.includes(OAUTH_CALLBACK_PATH)) {
    const frontendUrl = getPrimaryFrontendUrl();
    const reason = encodeURIComponent(err?.message || 'OAuth callback error');
    const redirectUrl = `${frontendUrl}/dashboard/settings?youtube=error&reason=${reason}`;
    logger.error('OAuth callback unhandled error — redirecting to frontend', {
      error: err?.message,
      redirectUrl,
    });
    return res.redirect(redirectUrl);
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  if (err instanceof SyntaxError && 'status' in err && (err as any).status === 400) {
    return res.status(400).json({
      success: false,
      message: 'Malformed request body. Check your JSON syntax.',
    });
  }

  if (err.name === 'UnauthorizedError' || err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token',
    });
  }

  if (err.name === 'RateLimitError') {
    return res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.',
    });
  }

  const statusCode = err.status || 500;

  ErrorFixerService.captureError({
    type: statusCode >= 500 ? 'backend' : 'api',
    severity: statusCode >= 500 ? 'high' : statusCode >= 400 ? 'medium' : 'low',
    message: err.message || 'Unknown error',
    stack: err.stack,
    route: req.originalUrl || req.url,
    userId: (req as any).userId,
    statusCode,
    context: {
      method: req.method,
      body: process.env.NODE_ENV === 'development' ? req.body : undefined,
      query: req.query,
    },
  });

  logger.error('Unhandled error', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  res.status(statusCode).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
}
