import { z } from 'zod';

export const getQueueJobsQuery = z.object({
  status: z.enum(['active', 'waiting', 'failed']).optional().default('failed'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});
