import { z } from 'zod';

export const createScheduleSchema = z.object({
  channelId: z.string().min(1, 'Channel ID is required'),
  niche: z.string().optional(),
  frequency: z.enum(['daily', 'every-other-day', 'twice-weekly', 'weekly']).optional().default('daily'),
  uploadDays: z.string().optional(),
  uploadTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format').optional().default('10:00'),
  timezone: z.string().optional().default('UTC'),
});

export const assignProjectToScheduleSchema = z.object({
  scheduleId: z.string().min(1, 'Schedule ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
});

export const generateThumbnailVariantsSchema = z.object({
  topic: z.string().min(1, 'Topic is required'),
  hook: z.string().min(1, 'Hook is required'),
  projectId: z.string().min(1, 'Project ID is required'),
  niche: z.string().optional(),
});

export const generateTitleVariantsSchema = z.object({
  topic: z.string().min(1, 'Topic is required'),
  hook: z.string().min(1, 'Hook is required'),
  niche: z.string().optional(),
});

export const analyzeTranscriptSchema = z.object({
  transcript: z.string().min(10, 'Transcript must be at least 10 characters'),
  title: z.string().min(1, 'Title is required'),
  videoId: z.string().min(1, 'Video ID is required'),
});

export const postUploadAnalysisSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
});

export const monetizationReportQuery = z.object({
  channelId: z.string().optional(),
});

export const viralOpportunitiesQuery = z.object({
  niche: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export const winningPatternsQuery = z.object({
  category: z.enum(['hook-structure', 'title-formula', 'thumbnail-style', 'pacing-style', 'storytelling-arc', 'cta-formula', 'emotional-trigger', 'retention-loop']).optional(),
  niche: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export const retentionScoreSchema = z.object({
  scriptContent: z.string().min(10, 'Script must be at least 10 characters'),
  format: z.enum(['Shorts', 'Longform']).optional().default('Longform'),
});

export const generateStrategySchema = z.object({
  niche: z.string().min(1, 'Niche is required'),
  channelId: z.string().optional(),
});

export const businessPredictThumbnailCTRSchema = z.object({
  style: z.string().min(1, 'Style is required'),
  topic: z.string().min(1, 'Topic is required'),
  niche: z.string().optional(),
});

export const predictTitleCTRSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  topic: z.string().min(1, 'Topic is required'),
  niche: z.string().optional(),
});

export const simulateRetentionSchema = z.object({
  scriptContent: z.string().min(10, 'Script must be at least 10 characters'),
  format: z.enum(['Shorts', 'Longform']).optional().default('Longform'),
  niche: z.string().optional(),
});

export const predictEarningsSchema = z.object({
  topic: z.string().min(1, 'Topic is required'),
  niche: z.string().min(1, 'Niche is required'),
  country: z.string().optional().default('US'),
});

export const createABTestSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  testType: z.enum(['title', 'thumbnail', 'hook', 'upload-timing']),
  variantA: z.string().min(1, 'Variant A is required'),
  variantB: z.string().min(1, 'Variant B is required'),
});

export const recordABTestResultSchema = z.object({
  testId: z.string().min(1, 'Test ID is required'),
  variant: z.enum(['A', 'B']),
  impressions: z.number().int().min(0),
  clicks: z.number().int().min(0),
  retention: z.number().min(0),
});

export const bestUploadTimeQuery = z.object({
  channelId: z.string().min(1, 'Channel ID is required'),
  timezone: z.string().optional().default('UTC'),
});

export const trackUploadTimeSchema = z.object({
  channelId: z.string().min(1, 'Channel ID is required'),
  uploadHour: z.number().int().min(0).max(23),
  uploadDay: z.string().min(1, 'Upload day is required'),
  views: z.number().int().min(0),
  ctr: z.number().min(0),
  retention: z.number().min(0),
});

export const humanizeScriptSchema = z.object({
  scriptContent: z.string().min(10, 'Script must be at least 10 characters'),
  format: z.enum(['Shorts', 'Longform']).optional().default('Longform'),
  niche: z.string().optional(),
});

export const enhanceScriptSchema = z.object({
  scriptContent: z.string().min(10, 'Script must be at least 10 characters'),
  format: z.enum(['Shorts', 'Longform']).optional().default('Longform'),
  niche: z.string().optional(),
});
