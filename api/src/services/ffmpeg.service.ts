// FFmpeg render service — improved with audio handling, subtitles, encoding options
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';

export type RenderOptions = {
  image?: string; // background image / thumbnail
  audio: string; // path to audio file
  output: string; // desired output path (mp4)
  duration?: number; // seconds
  subtitles?: { text: string; startTime: number; endTime: number }[]; // subtitle events
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: string; // e.g., '8000k' for quality
};

async function createSubtitleFile(subtitles: RenderOptions['subtitles'], srtPath: string) {
  if (!subtitles || subtitles.length === 0) return null;

  const srtContent = subtitles
    .map((s, i) => {
      const toTimestamp = (ms: number) => {
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        const ms_part = ms % 1000;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(ms_part).padStart(3, '0')}`;
      };
      return `${i + 1}\n${toTimestamp(s.startTime)} --> ${toTimestamp(s.endTime)}\n${s.text}\n`;
    })
    .join('\n');

  await fs.writeFile(srtPath, srtContent, 'utf8');
  return srtPath;
}

export async function renderVideo(opts: RenderOptions): Promise<string> {
  const {
    image,
    audio,
    output,
    duration = 30,
    subtitles,
    width = 1920,
    height = 1080,
    fps = 30,
    bitrate = '5000k',
  } = opts;

  const tmp = join(process.cwd(), 'tmp');
  await fs.mkdir(tmp, { recursive: true });

  // Create subtitle file if needed
  let srtPath: string | null = null;
  if (subtitles) {
    srtPath = join(tmp, `subs-${Date.now()}.srt`);
    await createSubtitleFile(subtitles, srtPath);
  }

  const args: string[] = [];

  // Video input
  if (image) {
    args.push('-loop', '1', '-i', image);
  } else {
    args.push('-f', 'lavfi', '-i', `color=size=${width}x${height}:rate=${fps}:color=black`);
  }

  // Audio input
  args.push('-i', audio);

  // Video filters (with optional subtitles)
  const filters: string[] = [];
  if (image) {
    filters.push(`scale=${width}:${height}`);
  }
  if (srtPath) {
    const escapedPath = srtPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
    filters.push(`subtitles=${escapedPath}`);
  }

  if (filters.length > 0) {
    args.push('-vf', filters.join(','));
  }

  // Audio codec and bitrate
  args.push('-c:a', 'aac', '-b:a', '192k');

  // Video codec and quality
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-b:v', bitrate);

  // Duration and sync
  args.push('-t', String(duration), '-shortest', output, '-y');

  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args);
    let stderr = '';
    let stdout = '';

    ff.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    ff.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    ff.on('close', async (code) => {
      // Cleanup subtitle file
      if (srtPath) {
        try { await fs.unlink(srtPath); } catch { }
      }

      if (code === 0) return resolve(output);
      return reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
    });

    ff.on('error', (err) => {
      if (srtPath) {
        try { fs.unlink(srtPath).catch(() => {}); } catch { }
      }
      reject(err);
    });
  });
}

export default { renderVideo };