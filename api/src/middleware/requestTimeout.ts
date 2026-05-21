import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function requestTimeout(ms: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      logger.warn(`Request timeout after ${ms}ms`, {
        method: req.method,
        url: req.originalUrl,
        reqId: (req as any).id,
      });
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: 'Request timeout',
          message: `Request exceeded ${ms}ms limit`,
        });
      }
    }, ms);

    const cleanup = () => clearTimeout(timer);
    res.once('finish', cleanup);
    res.once('close', cleanup);
    next();
  };
}
