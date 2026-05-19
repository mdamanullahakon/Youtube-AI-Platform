import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

const MUSIC_PALETTE: Record<string, { genre: string; bpm: number; description: string }[]> = {
  suspense: [
    { genre: 'dark-ambient', bpm: 60, description: 'deep bass drones, tension-building pads' },
    { genre: 'cinematic-drone', bpm: 70, description: 'slow evolving tension, mystery' },
  ],
  story: [
    { genre: 'cinematic-piano', bpm: 80, description: 'emotional piano with subtle strings' },
    { genre: 'soft-ambient', bpm: 75, description: 'warm pads, gentle atmosphere' },
  ],
  climax: [
    { genre: 'epic-orchestral', bpm: 120, description: 'building intensity, powerful brass' },
    { genre: 'action-drive', bpm: 130, description: 'high energy percussion, rising tension' },
  ],
  calm: [
    { genre: 'lo-fi', bpm: 70, description: 'chill beats, soft melody' },
    { genre: 'ambient-texture', bpm: 60, description: 'ethereal pads, gentle flow' },
  ],
  energetic: [
    { genre: 'upbeat-electronic', bpm: 128, description: 'driving beat, positive energy' },
    { genre: 'motivational', bpm: 115, description: 'inspiring build, uplifting' },
  ],
};

const EMOTION_TO_MOOD: Record<string, string> = {
  fear: 'suspense',
  curiosity: 'story',
  excitement: 'climax',
  calm: 'calm',
  sad: 'story',
  anger: 'climax',
  surprise: 'suspense',
  joy: 'energetic',
  inspiration: 'energetic',
  mystery: 'suspense',
};

export function selectMood(emotion: string): string {
  return EMOTION_TO_MOOD[emotion.toLowerCase()] || 'story';
}

export function selectGenre(mood: string): { genre: string; bpm: number } {
  const palette = MUSIC_PALETTE[mood] || MUSIC_PALETTE.story;
  const idx = Math.floor(Math.random() * palette.length);
  return { genre: palette[idx].genre, bpm: palette[idx].bpm };
}

export async function generateBackgroundAudio(
  voiceoverPath: string,
  outputPath: string,
  mood: string = 'story',
  duration?: number,
): Promise<string | null> {
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  const tempDir = join(process.cwd(), 'temp', 'music');
  await mkdir(tempDir, { recursive: true });

  try {
    const targetDuration = duration || await getAudioDuration(voiceoverPath);
    if (!targetDuration || targetDuration < 3) {
      logger.warn('Voiceover too short for music overlay, skipping BGM');
      return null;
    }

    const { bpm } = selectGenre(mood);
    const beats = Math.ceil((targetDuration * bpm) / 60);
    const musicDuration = (beats * 60) / bpm;

    const tempBgm = join(tempDir, `bgm_${Date.now()}.wav`);

    const toneFreq = mood === 'suspense' ? 55 : mood === 'climax' ? 65 : mood === 'calm' ? 45 : 52;
    const chorusDepth = mood === 'story' || mood === 'calm' ? '0.003' : '0.005';
    const reverbRoom = mood === 'climax' ? '0.8' : mood === 'suspense' ? '0.6' : '0.4';
    const reverbMix = mood === 'climax' ? '0.6' : mood === 'suspense' ? '0.5' : '0.3';

    const generateCmd = [
      `"${ffmpegPath}"`,
      '-f lavfi',
      `-i "sine=frequency=${toneFreq}:duration=${musicDuration}:r=44100[bass]"`,
      '-f lavfi',
      `-i "sine=frequency=${toneFreq * 2}:duration=${musicDuration}:r=44100[pad]"`,
      '-f lavfi',
      `-i "anoisesrc=d=${musicDuration}:c=pink:a=0.02[texture]"`,
      '-filter_complex "',
      `[bass]aformat=sample_rates=44100:channel_layouts=mono,`,
      `chorus=0.5:0.9:${chorusDepth}|0.4:0.7:${chorusDepth}|0.3:0.5:${chorusDepth},`,

      `aecho=0.8:0.6:20:0.4|0.8:0.3:40:0.2[bass_proc];`,

      `[pad]aformat=sample_rates=44100:channel_layouts=mono,`,
      `chorus=0.3:0.5:0.002,aecho=0.6:0.4:30:0.3[pad_proc];`,

      `[texture]aformat=sample_rates=44100:channel_layouts=mono,`,
      `lowpass=f=200,volume=0.3[texture_proc];`,

      `[bass_proc][pad_proc]amix=inputs=2:duration=first:dropout_transition=2,`,
      `volume=0.4[mix1];`,

      `[mix1][texture_proc]amix=inputs=2:duration=first:dropout_transition=2,`,
      `volume=1.0[raw];`,

      `[raw]afftfilt=`,
      `real='hypot(re,im)*sin(2*pi*${Math.random() * 0.5 + 0.5}*t)':`,
      `imag='hypot(re,im)*cos(2*pi*${Math.random() * 0.5 + 0.5}*t)',`,
      `volume=0.35[bgm]"`,
      `-c:a pcm_s16le "${tempBgm}" -y`,
    ].join(' ');

    await execAsync(generateCmd, { timeout: 120000 });

    if (!existsSync(tempBgm)) {
      logger.warn('BGM generation produced no output file');
      return null;
    }

    const duckedPath = join(tempDir, `ducked_${Date.now()}.wav`);

    const duckCmd = [
      `"${ffmpegPath}"`,
      `-i "${voiceoverPath}"`,
      `-i "${tempBgm}"`,
      '-filter_complex "',
      `[1:a]asidedata[v];`,
      `[0:a]asidedata[a];`,
      `[a]volume=1.0[voice];`,
      `[v]volume=0.35[bgm_base];`,
      `[voice]compand=attacks=0.01:decays=0.1:`,
      `points=-80/-80|-45/-15|-27/-9|0/-7|20/-7:`,
      `gain=5:volume=auto[voice_comp];`,
      `[voice_comp]alimiter=limit=0.8:attack=0.1:release=1[voice_lim];`,
      `[bgm_base]asidedata[bgm_side];`,

      `[voice_lim]dynaudnorm=p=0.5:g=5[smooth];`,

      `[bgm_base]volume=0.35[bgm_v];`,
      `[smooth]sidechaincompress=`,
      `threshold=0.3:`,
      `ratio=4:`,
      `attack=5:`,
      `release=100:`,
      `makeup=1[voice_sc];`,
      `[bgm_v][voice_sc]amix=inputs=2:duration=first:weights=0.3 0.7"`,
      `-c:a pcm_s16le "${duckedPath}" -y`,
    ].join(' ');

    await execAsync(duckCmd, { timeout: 120000 });

    const mixedPath = join(tempDir, `mixed_${Date.now()}.wav`);

    const finalCmd = [
      `"${ffmpegPath}"`,
      `-i "${duckedPath}"`,
      '-af "',
      `aformat=sample_rates=44100:channel_layouts=stereo,`,
      `volume=1.0,`,
      `alimiter=limit=0.9:attack=0.1:release=1"`,
      `-c:a pcm_s16le "${mixedPath}" -y`,
    ].join(' ');

    await execAsync(finalCmd, { timeout: 60000 });

    if (!existsSync(mixedPath)) {
      logger.warn('Final mix produced no output, using raw BGM');
      const silent = await copyAudioFile(tempBgm, outputPath);
      if (silent) return outputPath;
      return null;
    }

    await execAsync(
      `copy /y "${mixedPath}" "${outputPath}"`,
      { timeout: 10000, shell: 'cmd.exe' },
    ).catch(async () => {
      const fs = await import('fs/promises');
      await fs.copyFile(mixedPath, outputPath);
    });

    if (existsSync(outputPath)) {
      logger.info('Background music with ducking created', { mood, bpm, path: outputPath });
      return outputPath;
    }

    return null;
  } catch (error: any) {
    logger.warn('Background music generation failed', { error: error.message });
    return null;
  }
}

async function getAudioDuration(audioPath: string): Promise<number> {
  const ffprobe = process.env.FFPROBE_PATH || process.env.FFMPEG_PATH?.replace('ffmpeg', 'ffprobe') || 'ffprobe';
  try {
    const { stdout } = await execAsync(
      `"${ffprobe}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
      { timeout: 10000 },
    );
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

async function copyAudioFile(src: string, dest: string): Promise<boolean> {
  try {
    const fs = await import('fs/promises');
    await fs.copyFile(src, dest);
    return true;
  } catch {
    return false;
  }
}
