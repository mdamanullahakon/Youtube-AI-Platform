import { Request, Response, NextFunction } from 'express';
import hpp from 'hpp';
import compression from 'compression';

export function applySecurityMiddleware(app: any) {
  app.use(compression({ level: 6, threshold: 1024 }));

  app.use(hpp({
    whitelist: ['limit', 'offset', 'page', 'status', 'type', 'category', 'format'],
  }));
}

export function requestBodyLimit(req: Request, res: Response, next: NextFunction) {
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > 10 * 1024 * 1024) {
    return res.status(413).json({ success: false, message: 'Request body too large' });
  }
  next();
}
