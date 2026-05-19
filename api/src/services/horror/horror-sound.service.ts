import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { logger } from '../../utils/logger';

const execAsync = promisify(exec);

interface HorrorAudioSegment {
  type: 'ambient' | 'jump-scare' | 'heartbeat' | 'whisper' | 'rumble' | 'silence' | 'sting' | 'distortion';
  startTime: number;
  duration: number;
  parameters: Record<string, string | number | boolean>;
}

interface HorrorSoundtrack {
  segments: HorrorAudioSegment[];
  totalDuration: number;
  outputPath: string;
}

export class HorrorSoundEngine {
  private readonly ffmpegPath: string;

  constructor() {
    this.ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  }

  async generateHorrorSoundtrack(
    sceneCount: number,
    totalDurationSeconds: number,
    projectId: string
  ): Promise<HorrorSoundtrack | null> {
    const outputDir = join(process.cwd(), 'uploads', 'audio', projectId);
    await mkdir(outputDir, { recursive: true });

    const outputPath = join(outputDir, 'horror_soundtrack.wav');
    const segments = this.planHorrorAudio(sceneCount, totalDurationSeconds, projectId);

    try {
      await this.composeHorrorAudio(segments, outputPath, totalDurationSeconds);
      logger.info(`[HorrorSound] Soundtrack generated: ${outputPath} (${totalDurationSeconds}s)`);
      return { segments, totalDuration: totalDurationSeconds, outputPath };
    } catch (err: any) {
      logger.warn(`[HorrorSound] Soundtrack generation failed: ${err.message}`);
      return null;
    }
  }

  async generateJumpScareAudio(outputPath: string): Promise<boolean> {
    try {
      await mkdir(join(outputPath, '..'), { recursive: true });

      const cmd = `"${this.ffmpegPath}" -f lavfi -i "sine=frequency=800:duration=0.15" ` +
        `-f lavfi -i "sine=frequency=200:duration=0.1" ` +
        `-f lavfi -i "anoisesrc=d=0.3:c=pink:a=0.8" ` +
        `-filter_complex "[0:a][1:a]amix=inputs=2:duration=first:weights=2 1[scream];[scream][2:a]amix=inputs=2:duration=first:weights=1 0.5[out]" ` +
        `-map "[out]" -ac 1 -ar 22050 "${outputPath}" -y`;

      await execAsync(cmd, { timeout: 10000 });
      return existsSync(outputPath);
    } catch {
      logger.warn('[HorrorSound] Jump scare generation failed');
      return false;
    }
  }

  async generateAmbientDread(duration: number, outputPath: string, intensity: 'low' | 'medium' | 'high' = 'medium'): Promise<boolean> {
    try {
      await mkdir(join(outputPath, '..'), { recursive: true });
      const freq = intensity === 'low' ? 60 : intensity === 'high' ? 30 : 45;

      const cmd = `"${this.ffmpegPath}" -f lavfi -i "sine=frequency=${freq}:duration=${duration}" ` +
        `-f lavfi -i "anoisesrc=d=${duration}:c=pink:a=0.4" ` +
        `-f lavfi -i "anoisesrc=d=${duration}:c=brown:a=0.6" ` +
        `-filter_complex ` +
        `"[0:a]lowpass=f=200,volume=0.3[sub];` +
        `[1:a]equalizer=f=50:t=q:w=1:g=10,equalizer=f=2000:t=q:w=1:g=-20,volume=0.25[wind];` +
        `[2:a]volume=0.4[rumble];` +
        `[sub][wind]amix=inputs=2:duration=first[amb];` +
        `[amb][rumble]amix=inputs=2:duration=first:weights=1 0.7[out]" ` +
        `-map "[out]" -ac 1 -ar 22050 "${outputPath}" -y`;

      await execAsync(cmd, { timeout: duration * 1000 + 10000 });
      return existsSync(outputPath);
    } catch {
      logger.warn('[HorrorSound] Ambient dread generation failed');
      return false;
    }
  }

  async generateHeartbeat(duration: number, outputPath: string, accelerating: boolean = false): Promise<boolean> {
    try {
      await mkdir(join(outputPath, '..'), { recursive: true });

      const tempoChange = accelerating
        ? 'atempo=1.0,atempo=1.05,atempo=1.1,atempo=1.2'
        : 'atempo=1.0';

      const cmd = `"${this.ffmpegPath}" -f lavfi -i "sine=frequency=50:duration=${duration},volume=0.6" ` +
        `-f lavfi -i "anoisesrc=d=${duration}:c=brown:a=0.8" ` +
        `-filter_complex ` +
        `"[0:a]afade=t=in:d=0.5,afade=t=out:st=${duration - 2}:d=2,` +
        `aeval=val(0)*0.8+val(0)*0.2*if(lt(mod(t,1),0.1),1,0):c=same[heart];` +
        `[1:a]volume=0.3[base];` +
        `[heart][base]amix=inputs=2:duration=first:weights=1 0.4[out]" ` +
        `-map "[out]" -ac 1 -ar 22050 "${outputPath}" -y`;

      await execAsync(cmd, { timeout: duration * 1000 + 10000 });
      return existsSync(outputPath);
    } catch {
      return false;
    }
  }

  async generateStaticNoise(duration: number, outputPath: string): Promise<boolean> {
    try {
      await mkdir(join(outputPath, '..'), { recursive: true });
      const cmd = `"${this.ffmpegPath}" -f lavfi -i "anoisesrc=d=${duration}:c=white:a=0.7" ` +
        `-filter_complex "equalizer=f=100:t=q:w=1:g=-30,equalizer=f=10000:t=q:w=1:g=10,volume=0.3" ` +
        `-ac 1 -ar 22050 "${outputPath}" -y`;
      await execAsync(cmd, { timeout: duration * 1000 + 10000 });
      return existsSync(outputPath);
    } catch {
      return false;
    }
  }

  private planHorrorAudio(sceneCount: number, totalDuration: number, projectId: string): HorrorAudioSegment[] {
    const segments: HorrorAudioSegment[] = [];
    const sceneDuration = totalDuration / sceneCount;

    for (let i = 0; i < sceneCount; i++) {
      const startTime = i * sceneDuration;
      const segDuration = Math.max(3, sceneDuration - 0.5);

      if (i === 0) {
        segments.push({ type: 'ambient', startTime, duration: segDuration, parameters: { intensity: 'low' } });
        continue;
      }

      if (i % 8 === 0 && i > 0) {
        segments.push({ type: 'jump-scare', startTime, duration: 2, parameters: { volume: 1.0 } });
        segments.push({ type: 'silence', startTime: startTime + 2, duration: 1.5, parameters: { } });
        continue;
      }

      if (i % 5 === 0 && i > 0) {
        segments.push({ type: 'heartbeat', startTime, duration: segDuration, parameters: { accelerating: i % 10 === 0 } });
        continue;
      }

      if (i % 7 === 0 && i > 0) {
        segments.push({ type: 'sting', startTime, duration: 1, parameters: { frequency: 2000 } });
        continue;
      }

      if (i === Math.floor(sceneCount / 2)) {
        segments.push({ type: 'silence', startTime, duration: 3, parameters: { } });
        segments.push({ type: 'rumble', startTime: startTime + 3, duration: 8, parameters: { intensity: 'high' } });
        continue;
      }

      if (i > sceneCount - 3) {
        segments.push({ type: 'distortion', startTime, duration: segDuration, parameters: { intensity: 'high' } });
        continue;
      }

      const intensity = i < sceneCount / 3 ? 'low' : i < sceneCount * 0.7 ? 'medium' : 'high';
      segments.push({ type: 'ambient', startTime, duration: segDuration, parameters: { intensity } });
    }

    return segments;
  }

  private async composeHorrorAudio(
    segments: HorrorAudioSegment[],
    outputPath: string,
    totalDuration: number
  ): Promise<void> {
    const tempDir = join(outputPath, '..', 'segments');
    await mkdir(tempDir, { recursive: true });

    await this.generateAmbientDread(totalDuration, join(tempDir, 'base_ambient.wav'), 'low');
    await this.generateHeartbeat(totalDuration, join(tempDir, 'base_heart.wav'), false);

    for (const seg of segments) {
      if (seg.type === 'jump-scare') {
        await this.generateJumpScareAudio(join(tempDir, `jump_${seg.startTime}.wav`));
      }
    }

    const ambientPath = join(tempDir, 'base_ambient.wav');
    const heartPath = join(tempDir, 'base_heart.wav');

    if (!existsSync(ambientPath)) {
      logger.warn('[HorrorSound] Could not generate ambient base, creating silence');
      return;
    }

    const cmd = `"${this.ffmpegPath}" -i "${ambientPath}" -i "${heartPath}" ` +
      `-filter_complex "[0:a]volume=0.5[a];[1:a]volume=0.2[b];[a][b]amix=inputs=2:duration=first[out]" ` +
      `-map "[out]" -ac 1 -ar 22050 "${outputPath}" -y`;

    await execAsync(cmd, { timeout: 120000 });
  }
}
