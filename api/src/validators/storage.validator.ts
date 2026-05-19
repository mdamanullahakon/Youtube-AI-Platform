import { z } from 'zod';

export const getStorageFilesQuery = z.object({
  type: z.enum(['temp', 'videos', 'voiceovers', 'thumbnails', 'logs']).optional().default('temp'),
});

export const queueCleanupSchema = z.object({
  types: z.array(z.enum(['temp', 'videos', 'voiceovers', 'thumbnails', 'logs'])).optional().default(['temp', 'voiceovers', 'logs', 'videos']),
});
