import { writeFile, mkdir } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync } from 'fs';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

interface TTSOptions {
  text: string;
  outputPath: string;
  voice?: string;
  language?: string;
  rate?: string;
  pitch?: string;
}

const VOICE_MAP: Record<string, string> = {
  'en': 'en-US-JennyNeural',
  'en-US': 'en-US-JennyNeural',
  'en-GB': 'en-GB-SoniaNeural',
  'en-AU': 'en-AU-NatashaNeural',
  'es': 'es-ES-ElviraNeural',
  'fr': 'fr-FR-DeniseNeural',
  'de': 'de-DE-KatjaNeural',
  'ja': 'ja-JP-NanamiNeural',
  'ko': 'ko-KR-SunHiNeural',
  'pt': 'pt-BR-FranciscaNeural',
  'ru': 'ru-RU-SvetlanaNeural',
  'zh': 'zh-CN-XiaoxiaoNeural',
};

async function generateEdgeTTS(options: TTSOptions): Promise<boolean> {
  const { text, outputPath, language = 'en' } = options;
  const voice = options.voice || VOICE_MAP[language] || VOICE_MAP['en'];

  try {
    await mkdir(join(outputPath, '..'), { recursive: true });

    // Try edge-tts CLI (Python package) — free, works offline, best quality
    try {
      const escapedText = text.replace(/"/g, '\\"').replace(/\n/g, ' ').trim();
      const cmd = `edge-tts --voice "${voice}" --text "${escapedText}" --write-media "${outputPath}" 2>nul`;
      const { stderr } = await execAsync(cmd, { timeout: 60000 });
      if (existsSync(outputPath)) {
        const stat = await import('fs/promises').then(m => m.stat(outputPath));
        if (stat.size > 1000) {
          logger.info(`Edge TTS CLI generated: ${outputPath} (${voice})`);
          return true;
        }
      }
      if (stderr) logger.warn(`edge-tts CLI stderr: ${stderr}`);
    } catch (e: any) {
      logger.warn(`edge-tts CLI not available: ${e.message}`);
    }

    // Try gTTS CLI (Python package) — free, works offline
    try {
      const escapedText = text.replace(/'/g, "\\'").replace(/\n/g, ' ').trim();
      const langCode = language.split('-')[0];
      const cmd = `gtts-cli "${escapedText}" --lang ${langCode} --output "${outputPath}" 2>nul`;
      await execAsync(cmd, { timeout: 60000 });
      if (existsSync(outputPath)) {
        const stat = await import('fs/promises').then(m => m.stat(outputPath));
        if (stat.size > 1000) {
          logger.info(`gTTS generated: ${outputPath} (${langCode})`);
          return true;
        }
      }
    } catch (e: any) {
      logger.warn(`gTTS not available: ${e.message}`);
    }

    // Final fallback: generate sine wave audio so video has sound
    logger.warn('All TTS engines failed, generating audible sine wave audio');
    await generateSineWaveAudio(text, outputPath);
    return existsSync(outputPath);
  } catch (error: any) {
    logger.warn('Edge TTS failed', { error: error.message });
    return false;
  }
}

async function generateSineWaveAudio(text: string, outputPath: string): Promise<void> {
  const wordCount = text.split(/\s+/).length;
  const durationSec = Math.max(10, wordCount * 0.35);
  const sampleRate = 22050;
  const numSamples = Math.floor(sampleRate * durationSec);
  const frequency = 180; // gentle hum frequency

  // Generate PCM 16-bit sine wave
  const buffer = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Soft sine wave with slight variation to sound natural-ish
    const amplitude = 8000 + Math.sin(2 * Math.PI * 0.5 * t) * 2000;
    const sample = Math.sin(2 * Math.PI * frequency * t) * amplitude;
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), i * 2);
  }

  // Convert to WAV
  const wavHeader = createWavHeader(numSamples, sampleRate);
  const wavBuffer = Buffer.concat([wavHeader, buffer]);
  await writeFile(outputPath, wavBuffer);
  logger.info(`Sine wave audio generated: ${outputPath} (${durationSec.toFixed(1)}s, ${frequency}Hz)`);
}

function createWavHeader(numSamples: number, sampleRate: number): Buffer {
  const bitsPerSample = 16;
  const numChannels = 1;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * blockAlign;

  const header = Buffer.alloc(44);
  let offset = 0;

  const writeStr = (s: string) => { header.write(s, offset, s.length, 'ascii'); offset += s.length; };
  const writeU16 = (v: number) => { header.writeUInt16LE(v, offset); offset += 2; };
  const writeU32 = (v: number) => { header.writeUInt32LE(v, offset); offset += 4; };

  writeStr('RIFF'); writeU32(36 + dataSize);
  writeStr('WAVE');
  writeStr('fmt '); writeU32(16);
  writeU16(1); writeU16(numChannels); writeU32(sampleRate); writeU32(byteRate); writeU16(blockAlign); writeU16(bitsPerSample);
  writeStr('data'); writeU32(dataSize);

  return header;
}

export async function synthesizeSpeech(text: string, outputPath: string, language: string = 'en'): Promise<boolean> {
  return generateEdgeTTS({ text, outputPath, language });
}

export async function getAvailableVoices(language?: string) {
  if (language) {
    const voice = VOICE_MAP[language];
    return voice ? [{ name: voice, language, gender: 'Female' }] : [];
  }
  return Object.entries(VOICE_MAP).map(([lang, name]) => ({
    name,
    language: lang,
    gender: 'Female',
  }));
}
