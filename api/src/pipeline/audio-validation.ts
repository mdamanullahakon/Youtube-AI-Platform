import { existsSync } from 'fs';
import { stat } from 'fs/promises';
import { join } from 'path';

const MIN_AUDIO_BYTES = 100;

/** Validates voiceover URL points to a real audio file on disk. */
export async function validateVoiceoverAudioFile(audioUrl: string | null | undefined): Promise<string> {
  if (!audioUrl || typeof audioUrl !== 'string' || !audioUrl.trim()) {
    throw new Error('Voiceover audioUrl is missing — pipeline cannot render without audio');
  }

  const absPath = join(process.cwd(), audioUrl.replace(/^\//, ''));
  if (!existsSync(absPath)) {
    throw new Error(`Voiceover file not found: ${absPath}`);
  }

  const fileStat = await stat(absPath);
  if (fileStat.size < MIN_AUDIO_BYTES) {
    throw new Error(`Voiceover file too small (${fileStat.size} bytes): ${absPath}`);
  }

  return absPath;
}
