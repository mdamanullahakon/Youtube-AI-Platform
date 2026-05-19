import { z } from 'zod';

export const updateSettingsSchema = z.object({
  geminiKey: z.string().optional(),
  youtubeApiKey: z.string().optional(),
  preferredModel: z.enum(['ollama', 'gemini']).optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
