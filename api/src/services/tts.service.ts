// TTS service — ElevenLabs integration with fallback scaffold
import { promises as fs } from 'fs';
import { join } from 'path';
import axios from 'axios';

export type TTSOptions = {
  voice?: string;
  emotion?: string;
  language?: string;
};

async function ensureTmpDir() {
  const dir = join(process.cwd(), 'tmp');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function synthesizeSpeech(text: string, opts: TTSOptions = {}): Promise<string> {
  const tmp = await ensureTmpDir();
  const fileNameBase = `tts-${Date.now()}`;

  const elevenKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = opts.voice || process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

  if (elevenKey) {
    try {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
      const outPath = join(tmp, `${fileNameBase}.mp3`);

      const resp = await axios.post(url, { text }, {
        responseType: 'arraybuffer',
        headers: {
          'xi-api-key': elevenKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        timeout: 120000,
      });

      await fs.writeFile(outPath, Buffer.from(resp.data));
      return outPath;
    } catch (err: any) {
      console.warn('[TTS] ElevenLabs request failed, falling back to placeholder:', err.message || err);
    }
  }

  // Fallback: write a placeholder text artifact
  const fileName = `${fileNameBase}.txt`;
  const outPath = join(tmp, fileName);
  const content = `TTS_PLACEHOLDER\nvoice=${opts.voice || 'default'}\nemotion=${opts.emotion || 'neutral'}\nlanguage=${opts.language || 'en'}\n---\n${text}`;
  await fs.writeFile(outPath, content, 'utf8');
  return outPath;
}

export default { synthesizeSpeech };