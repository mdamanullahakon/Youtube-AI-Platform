// DEPRECATED: In-memory rate limiter removed (OOM risk with unbounded Map growth).
// Use redisRateLimiter from '../services/security.service' instead.
import { redisRateLimiter } from '../services/security.service';
export const rateLimiter = redisRateLimiter;
