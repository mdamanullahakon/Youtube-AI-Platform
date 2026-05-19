import { z } from 'zod';

export const analyzeTISchema = z.object({
  videoIds: z.array(z.string().min(1)).min(1, 'At least one video ID is required'),
  projectId: z.string().optional(),
  enhanceWithAI: z.boolean().optional().default(true),
});

export const analyzeTextSchema = z.object({
  transcriptText: z.string().min(10, 'Transcript text must be at least 10 characters'),
  sourceVideoIds: z.array(z.string().min(1)).optional().default([]),
  projectId: z.string().optional().default(''),
  enhanceWithAI: z.boolean().optional().default(true),
});

export const getInsightsQuery = z.object({
  category: z.enum(['hook', 'structure', 'pacing', 'cta', 'emotional', 'retention', 'storytelling', 'general']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const getScriptImprovementsQuery = z.object({
  topic: z.string().min(1, 'Topic is required'),
  format: z.string().optional().default('Shorts'),
});

export type AnalyzeTIInput = z.infer<typeof analyzeTISchema>;
export type AnalyzeTextInput = z.infer<typeof analyzeTextSchema>;
