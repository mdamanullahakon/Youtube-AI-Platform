import axios from 'axios';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger';

export async function generateWithCoqui(text: string, outputPath: string, language: string = 'en'): Promise<boolean> {
  try {
    await mkdir(join(outputPath, '..'), { recursive: true });

    const coquiUrl = process.env.COQUI_URL || 'http://localhost:8020';

    const response = await axios.post(
      `${coquiUrl}/tts`,
      {
        text,
        language,
        speaker_id: process.env.COQUI_SPEAKER_ID || '',
        speed: 1.0,
      },
      {
        responseType: 'arraybuffer',
        timeout: 60000,
      }
    ).catch(() => null);

    if (response?.data) {
      await writeFile(outputPath, Buffer.from(response.data));
      logger.info(`Coqui TTS generated: ${outputPath}`);
      return true;
    }

    return false;
  } catch (error: any) {
    logger.warn('Coqui TTS failed', { error: error.message });
    return false;
  }
}

export async function isCoquiAvailable(): Promise<boolean> {
  try {
    const coquiUrl = process.env.COQUI_URL || 'http://localhost:8020';
    await axios.get(`${coquiUrl}/health`, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
