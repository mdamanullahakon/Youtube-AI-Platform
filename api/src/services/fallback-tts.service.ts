import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger';

function generateSineWav(durationMs: number, sampleRate = 22050, frequency = 180): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const numSamples = Math.floor(sampleRate * (durationMs / 1000));
  const dataSize = numSamples * blockAlign;

  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;

  const writeString = (str: string) => { buffer.write(str, offset, str.length, 'ascii'); offset += str.length; };
  const writeU16 = (v: number) => { buffer.writeUInt16LE(v, offset); offset += 2; };
  const writeU32 = (v: number) => { buffer.writeUInt32LE(v, offset); offset += 4; };

  writeString('RIFF');
  writeU32(36 + dataSize);
  writeString('WAVE');
  writeString('fmt ');
  writeU32(16);
  writeU16(1);
  writeU16(numChannels);
  writeU32(sampleRate);
  writeU32(byteRate);
  writeU16(blockAlign);
  writeU16(bitsPerSample);
  writeString('data');
  writeU32(dataSize);

  // Fill with sine wave (audible, not silent)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const amplitude = 6000 + Math.sin(2 * Math.PI * 0.3 * t) * 2000;
    const sample = Math.sin(2 * Math.PI * frequency * t) * amplitude;
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), offset);
    offset += 2;
  }

  return buffer;
}

export async function generateFallbackAudio(
  text: string,
  outputPath: string,
  _language: string = 'en'
): Promise<boolean> {
  try {
    const dir = join(outputPath, '..');
    await mkdir(dir, { recursive: true });

    const wordCount = text.split(/\s+/).length;
    const durationMs = Math.max(8000, wordCount * 350);

    const wavBuffer = generateSineWav(durationMs);
    await writeFile(outputPath, wavBuffer);

    logger.info(`Fallback audio generated: ${outputPath} (${durationMs}ms, ${wordCount} words, audible sine wave)`);
    return true;
  } catch (err: any) {
    logger.error('Fallback audio generation failed', { error: err.message });
    return false;
  }
}
