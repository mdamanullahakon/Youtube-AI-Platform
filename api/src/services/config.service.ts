import { prisma } from '../config/db';
import { encrypt, decrypt } from '../utils/encryption';

export const REQUIRED_CONFIG_KEYS = [
  { key: 'TRANSCRIPT_API_KEY', label: 'Transcript API Key', section: 'transcript', link: 'https://platform.openai.com/api-keys', docUrl: 'https://platform.openai.com/docs/guides/speech-to-text' },
  { key: 'SMTP_HOST', label: 'SMTP Host', section: 'smtp', link: '', docUrl: '' },
  { key: 'SMTP_USER', label: 'SMTP User', section: 'smtp', link: '', docUrl: '' },
  { key: 'SMTP_PASS', label: 'SMTP Password', section: 'smtp', link: '', docUrl: '' },
  { key: 'YOUTUBE_CLIENT_ID', label: 'YouTube OAuth Client ID', section: 'youtube', link: 'https://console.cloud.google.com/apis/credentials', docUrl: 'https://developers.google.com/youtube/v3/guides/authentication' },
  { key: 'YOUTUBE_CLIENT_SECRET', label: 'YouTube OAuth Client Secret', section: 'youtube', link: 'https://console.cloud.google.com/apis/credentials', docUrl: 'https://developers.google.com/youtube/v3/guides/authentication' },
  { key: 'YOUTUBE_REFRESH_TOKEN', label: 'YouTube Refresh Token', section: 'youtube', link: '', docUrl: 'https://developers.google.com/youtube/v3/guides/authentication' },
  { key: 'OAUTH_STATE_SECRET', label: 'OAuth State Secret', section: 'youtube', link: '', docUrl: '' },
  { key: 'GEMINI_API_KEY', label: 'Gemini API Key', section: 'gemini', link: 'https://aistudio.google.com/apikey', docUrl: 'https://ai.google.dev/gemini-api/docs' },
] as const;

export type ConfigSection = 'gemini' | 'youtube' | 'smtp' | 'transcript';

export async function getConfigValue(key: string): Promise<string | null> {
  const envVal = process.env[key];
  if (envVal && envVal.length > 0) return envVal;

  try {
    const row = await prisma.appConfig.findUnique({ where: { key } });
    if (row?.value) {
      try { return decrypt(row.value); } catch { return row.value; }
    }
  } catch {
    return null;
  }

  return null;
}

export async function setConfigValue(key: string, value: string, userId?: string, description?: string): Promise<void> {
  const encrypted = encrypt(value);
  await prisma.appConfig.upsert({
    where: { key },
    update: { value: encrypted, userId: userId || null, description: description || null },
    create: { key, value: encrypted, userId: userId || null, description: description || null },
  });
}

export async function deleteConfigValue(key: string): Promise<void> {
  try {
    await prisma.appConfig.delete({ where: { key } });
  } catch {
    // key might not exist
  }
}

export interface ConfigStatus {
  key: string;
  label: string;
  section: ConfigSection;
  link: string;
  docUrl: string;
  present: boolean;
  source: 'env' | 'database' | 'missing';
}

export async function getConfigStatus(): Promise<ConfigStatus[]> {
  const results: ConfigStatus[] = [];

  for (const cfg of REQUIRED_CONFIG_KEYS) {
    const envVal = process.env[cfg.key];
    if (envVal && envVal.length > 0) {
      results.push({ ...cfg, present: true, source: 'env' });
      continue;
    }

    try {
      const row = await prisma.appConfig.findUnique({ where: { key: cfg.key } });
      if (row?.value) {
        results.push({ ...cfg, present: true, source: 'database' });
        continue;
      }
    } catch {
      // DB might not be accessible
    }

    results.push({ ...cfg, present: false, source: 'missing' });
  }

  return results;
}

export async function getMissingConfigKeys(): Promise<ConfigStatus[]> {
  const status = await getConfigStatus();
  return status.filter((s) => !s.present);
}

export async function isFullyConfigured(): Promise<boolean> {
  const missing = await getMissingConfigKeys();
  return missing.length === 0;
}
