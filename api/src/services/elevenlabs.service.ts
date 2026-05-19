import axios from 'axios';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger';
import { getConfigValue } from '../services/config.service';

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';

const VOICE_IDS: Record<string, string> = {
  emotional: '21m00Tcm4TlvDq8ikWAM',
  storyteller: 'ODq5zmih8GrVes37Dizd',
  calm: 'piTKgcLEGmPE4e6mEKli',
  excited: 'XB0fDUnXU5powFXDhCwa',
  default: '21m00Tcm4TlvDq8ikWAM',
};

export async function generateVoiceover(
  text: string,
  outputPath: string,
  tone: string = 'emotional',
): Promise<boolean> {
  try {
    const apiKey = await getConfigValue('ELEVENLABS_API_KEY');
    if (!apiKey) {
      logger.warn('ElevenLabs API key not configured, skipping');
      return false;
    }

    const voiceId = VOICE_IDS[tone] || VOICE_IDS.default;

    await mkdir(join(outputPath, '..'), { recursive: true });

    const response = await axios.post(
      `${ELEVENLABS_API}/text-to-speech/${voiceId}`,
      {
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.35,
          similarity_boost: 0.75,
          style: 0.3,
          use_speaker_boost: true,
        },
      },
      {
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        responseType: 'arraybuffer',
        timeout: 120000,
      },
    );

    await writeFile(outputPath, Buffer.from(response.data));
    logger.info(`ElevenLabs voiceover generated: ${outputPath}`);
    return true;
  } catch (error: any) {
    if (error?.response?.status === 401) {
      logger.warn('ElevenLabs: Invalid API key');
    } else if (error?.response?.status === 429) {
      logger.warn('ElevenLabs: Rate limited, will use fallback TTS');
    } else {
      logger.warn(`ElevenLabs TTS failed: ${error.message}`);
    }
    return false;
  }
}
