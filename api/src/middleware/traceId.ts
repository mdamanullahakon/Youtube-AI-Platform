import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export function traceId(req: Request, _res: Response, next: NextFunction): void {
  const traceId = (req.headers['x-trace-id'] as string) || randomUUID();
  req.traceId = traceId;
  next();
}

declare global {
  namespace Express {
    interface Request {
      traceId: string;
    }
  }
}
