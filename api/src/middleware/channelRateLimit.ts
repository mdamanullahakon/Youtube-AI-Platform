import { Request, Response, NextFunction } from 'express';
import { channelLimiter } from '../services/channel-limiter.service';
import { logger } from '../utils/logger';

export function channelRateLimit(req: Request, res: Response, next: NextFunction): void {
  const channelId = req.headers['x-channel-id'] as string;
  if (!channelId) {
    next();
    return;
  }

  channelLimiter.check(channelId).then(result => {
    if (!result.allowed) {
      logger.warn(`[RateLimit] Channel ${channelId} rate limited, retry after ${result.retryAfterSeconds}s`);
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      res.status(429).json({
        error: 'rate_limit_exceeded',
        message: `Channel rate limit exceeded. Retry after ${result.retryAfterSeconds} seconds.`,
        retryAfterSeconds: result.retryAfterSeconds,
      });
      return;
    }
    next();
  }).catch(err => {
    logger.error('[RateLimit] Error checking channel rate limit', { error: err.message, channelId });
    next();
  });
}
