import { Response } from 'express';
import { getConfigStatus, setConfigValue, deleteConfigValue, getMissingConfigKeys, isFullyConfigured } from '../services/config.service';
import { getTestHandler, ASSISTANT_ANSWERS } from '../services/config-test.service';
import { apiLogger } from '../utils/logger';
import type { AuthRequest } from '../middleware/auth';
import { z } from 'zod';

const setConfigSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  description: z.string().optional(),
});

export async function getStatus(_req: AuthRequest, res: Response) {
  try {
    const status = await getConfigStatus();
    res.json({ success: true, data: status });
  } catch (error: any) {
    apiLogger.error('Get config status failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get config status' });
  }
}

export async function getMissing(_req: AuthRequest, res: Response) {
  try {
    const missing = await getMissingConfigKeys();
    const configured = await isFullyConfigured();
    res.json({ success: true, data: { missing, fullyConfigured: configured } });
  } catch (error: any) {
    apiLogger.error('Get missing config failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get missing config' });
  }
}

export async function setConfig(req: AuthRequest, res: Response) {
  try {
    const parsed = setConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        errors: parsed.error.errors.map((e) => e.message),
      });
    }

    const { key, value, description } = parsed.data;
    await setConfigValue(key, value, req.userId || undefined, description);

    apiLogger.info(`Config saved: ${key}`, { userId: req.userId });
    res.json({ success: true, message: `${key} saved successfully` });
  } catch (error: any) {
    apiLogger.error('Set config failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to save config' });
  }
}

export async function deleteConfig(req: AuthRequest, res: Response) {
  try {
    const key = req.params.key as string;
    if (!key) {
      return res.status(400).json({ success: false, message: 'Key is required' });
    }
    await deleteConfigValue(key);
    res.json({ success: true, message: `${key} deleted` });
  } catch (error: any) {
    apiLogger.error('Delete config failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to delete config' });
  }
}

const testConfigSchema = z.object({
  section: z.enum(['gemini', 'youtube', 'smtp', 'transcript']),
});

export async function testConfig(req: AuthRequest, res: Response) {
  try {
    const parsed = testConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        errors: parsed.error.errors.map((e) => e.message),
      });
    }

    const handler = getTestHandler(parsed.data.section);
    if (!handler) {
      return res.status(400).json({ success: false, message: `Unknown section: ${parsed.data.section}` });
    }

    const result = await handler();
    res.json({ success: result.success, message: result.message, details: result.details });
  } catch (error: any) {
    apiLogger.error('Test config failed', { error: error.message });
    res.status(500).json({ success: false, message: `Test failed: ${error.message}` });
  }
}

const assistantQuerySchema = z.object({
  query: z.string().min(1).max(500),
});

export async function assistantQuery(req: AuthRequest, res: Response) {
  try {
    const parsed = assistantQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        errors: parsed.error.errors.map((e) => e.message),
      });
    }

    const query = parsed.data.query.toLowerCase();

    if (query.includes('gemini')) {
      return res.json({ success: true, answer: ASSISTANT_ANSWERS['gemini'] });
    }
    if (query.includes('youtube') || query.includes('oauth') || query.includes('channel')) {
      return res.json({ success: true, answer: ASSISTANT_ANSWERS['youtube'] });
    }
    if (query.includes('smtp') || query.includes('email') || query.includes('gmail') || query.includes('app password')) {
      return res.json({ success: true, answer: ASSISTANT_ANSWERS['smtp'] });
    }
    if (query.includes('transcript') || query.includes('whisper') || query.includes('assembly') || query.includes('caption')) {
      return res.json({ success: true, answer: ASSISTANT_ANSWERS['transcript'] });
    }
    if (query.includes('fail') || query.includes('error') || query.includes('not work') || query.includes('broken') || query.includes('issue')) {
      return res.json({ success: true, answer: ASSISTANT_ANSWERS['test-failed'] });
    }

    return res.json({ success: true, answer: ASSISTANT_ANSWERS['default'] });
  } catch (error: any) {
    apiLogger.error('Assistant query failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Assistant unavailable' });
  }
}
