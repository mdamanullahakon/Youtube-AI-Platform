import { z } from 'zod';

export const initializeGodmodeSchema = z.object({
  niche: z.string().min(1, 'Niche is required'),
  language: z.enum(['bangla', 'english', 'both']).optional().default('english'),
  channelName: z.string().optional(),
  userId: z.string().optional(),
});

export const scanTrendsSchema = z.object({
  niche: z.string().optional(),
});

export const analyzeTopicsSchema = z.object({
  topics: z.array(z.string().min(1)).min(1, 'At least one topic is required'),
});

export const generateVideoIdeaSchema = z.object({
  topic: z.string().min(1, 'Topic is required'),
  niche: z.string().min(1, 'Niche is required'),
  format: z.enum(['Shorts', 'Longform']).optional().default('Shorts'),
  saveToDatabase: z.boolean().optional().default(false),
});

export const generateScriptSchema = z.object({
  topic: z.string().min(1, 'Topic is required'),
  format: z.enum(['Shorts', 'Longform']).optional().default('Shorts'),
  niche: z.string().optional(),
  emotionalAngle: z.string().optional(),
  hookSuggestion: z.string().optional(),
});

export const generateRoadmapSchema = z.object({
  niche: z.string().min(1, 'Niche is required'),
  language: z.enum(['bangla', 'english', 'both']).optional().default('english'),
  format: z.enum(['Shorts', 'Longform', 'mixed']).optional().default('mixed'),
});

export const generateBlueprintSchema = z.object({
  niche: z.string().min(1, 'Niche is required'),
  language: z.enum(['bangla', 'english', 'both']).optional().default('english'),
  channelName: z.string().optional(),
});

export const getNicheRecommendationsQuery = z.object({
  refresh: z.coerce.boolean().optional().default(false),
});

export const godmodeTitleVariantsSchema = z.object({
  topic: z.string().min(1, 'Topic is required'),
  count: z.coerce.number().int().min(1).max(10).optional().default(5),
});

export const generateHookVariantsSchema = z.object({
  topic: z.string().min(1, 'Topic is required'),
  count: z.coerce.number().int().min(1).max(10).optional().default(5),
});