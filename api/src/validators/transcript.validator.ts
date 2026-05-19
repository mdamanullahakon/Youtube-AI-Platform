import { z } from 'zod';

export const analyzeTranscriptsSchema = z.object({
  videoIds: z.array(z.string().min(1)).min(1, 'At least one video ID is required'),
});

export type AnalyzeTranscriptsInput = z.infer<typeof analyzeTranscriptsSchema>;
