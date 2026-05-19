import { z } from 'zod';

export const analyzeProjectLearningSchema = z.object({
  enhanceWithAI: z.boolean().optional().default(true),
});

export const predictThumbnailCTRSchema = z.object({
  style: z.string().min(1, 'Style is required'),
  topic: z.string().min(1, 'Topic is required'),
});

export const saveThumbnailPerformanceSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  style: z.string().min(1, 'Style is required'),
  prompt: z.string().optional().default(''),
  predictedCTR: z.number().min(0).max(100).optional().default(0),
});

export const getScriptFeedbackQuery = z.object({
  topic: z.string().optional(),
  format: z.string().optional().default('Shorts'),
});

export type AnalyzeProjectLearningInput = z.infer<typeof analyzeProjectLearningSchema>;
export type PredictThumbnailCTRInput = z.infer<typeof predictThumbnailCTRSchema>;
export type SaveThumbnailPerformanceInput = z.infer<typeof saveThumbnailPerformanceSchema>;
