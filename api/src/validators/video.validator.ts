import { z } from 'zod';

export const createProjectSchema = z.object({
  topic: z.string().min(1).max(200).optional().default('trending topic'),
});

export const generateVideoSchema = z.object({
  projectId: z.string().cuid('Invalid project ID'),
});

export const renderVideoSchema = z.object({
  projectId: z.string().cuid('Invalid project ID'),
  resolution: z.enum(['1920x1080', '1080x1920', '3840x2160']).optional().default('1920x1080'),
  subtitle: z.boolean().optional().default(true),
});

export const uploadVideoSchema = z.object({
  projectId: z.string().cuid('Invalid project ID'),
  privacyStatus: z.enum(['public', 'private', 'unlisted']).optional().default('public'),
  categoryId: z.string().optional(),
  playlistId: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
});

export type GenerateVideoInput = z.infer<typeof generateVideoSchema>;
export type RenderVideoInput = z.infer<typeof renderVideoSchema>;
export type UploadVideoInput = z.infer<typeof uploadVideoSchema>;
