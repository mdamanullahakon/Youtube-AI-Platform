import { Response } from 'express';
import { prisma } from '../config/db';
import { apiLogger } from '../utils/logger';
import { encrypt, decrypt } from '../utils/encryption';
import type { AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const saveKeysSchema = z.object({
  geminiKey: z.string().optional(),
  youtubeApiKey: z.string().optional(),
});

export async function saveApiKeys(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const parsed = saveKeysSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        errors: parsed.error.errors.map(e => e.message),
      });
    }

    const data: any = {};
    if (parsed.data.geminiKey !== undefined) {
      data.geminiKey = parsed.data.geminiKey ? encrypt(parsed.data.geminiKey) : null;
    }
    if (parsed.data.youtubeApiKey !== undefined) {
      data.youtubeApiKey = parsed.data.youtubeApiKey ? encrypt(parsed.data.youtubeApiKey) : null;
    }

    await prisma.settings.upsert({
      where: { userId: req.userId },
      update: data,
      create: { userId: req.userId, ...data },
    });

    res.json({ success: true, message: 'API keys saved successfully' });
  } catch (error: any) {
    apiLogger.error('Save API keys failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to save API keys' });
  }
}

export async function getApiKeys(req: AuthRequest, res: Response) {
  try {
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const settings = await prisma.settings.findUnique({
      where: { userId: req.userId },
    });

    if (!settings) {
      return res.json({ success: true, data: { geminiKey: null, youtubeApiKey: null } });
    }

    let geminiKey: string | null = null;
    let youtubeApiKey: string | null = null;

    if (settings.geminiKey) {
      try { geminiKey = decrypt(settings.geminiKey); } catch { geminiKey = settings.geminiKey; }
    }
    if (settings.youtubeApiKey) {
      try { youtubeApiKey = decrypt(settings.youtubeApiKey); } catch { youtubeApiKey = settings.youtubeApiKey; }
    }

    res.json({ success: true, data: { geminiKey, youtubeApiKey } });
  } catch (error: any) {
    apiLogger.error('Get API keys failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get API keys' });
  }
}
