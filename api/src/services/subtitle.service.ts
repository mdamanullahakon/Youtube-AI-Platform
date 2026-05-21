import { writeFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger';
import type { ScenePlan } from './scene.service';

interface SubtitleEntry {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

// ASS style override for subtitles filter
// Alignment=10 means center vertically + horizontally
// BorderStyle=1 means outline + shadow
export function getSubtitleStyle(): string {
  return [
    'Alignment=10',
    'FontName=Arial',
    'FontSize=22',
    'PrimaryColour=&H00FFFFFF',
    'SecondaryColour=&H00FFFFFF',
    'OutlineColour=&H80000000',
    'BackColour=&H80000000',
    'BorderStyle=1',
    'Outline=1',
    'Shadow=1',
    'MarginV=40',
    'WrapStyle=2',
  ].join(',');
}

function formatSrtTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.floor(ms % 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function splitSubtitleText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);

  let current = '';
  for (const sentence of sentences) {
    if ((current + sentence).length <= maxChars) {
      current += (current ? ' ' : '') + sentence;
    } else {
      if (current) chunks.push(current.trim());
      if (sentence.length > maxChars) {
        const words = sentence.split(/\s+/);
        let wordChunk = '';
        for (const word of words) {
          if ((wordChunk + word).length > maxChars) {
            chunks.push(wordChunk.trim());
            wordChunk = word;
          } else {
            wordChunk += (wordChunk ? ' ' : '') + word;
          }
        }
        if (wordChunk) current = wordChunk;
        else current = '';
      } else {
        current = sentence;
      }
    }
  }
  if (current) chunks.push(current.trim());

  return chunks.length ? chunks : [text.substring(0, maxChars)];
}

export function generateSubtitles(scenes: ScenePlan[], transitionDurationMs: number = 0): {
  entries: SubtitleEntry[];
  srtContent: string;
} {
  const entries: SubtitleEntry[] = [];
  let currentTime = 0;

  for (let sceneIdx = 0; sceneIdx < scenes.length; sceneIdx++) {
    const scene = scenes[sceneIdx];
    const sceneDurationMs = scene.duration * 1000;

    const xfadeShift = sceneIdx * transitionDurationMs;
    const correctedStart = currentTime - xfadeShift;
    const correctedDuration = sceneDurationMs - transitionDurationMs;
    const actualDuration = Math.max(correctedDuration, 1000);

    const chunks = splitSubtitleText(scene.text, 60);
    const chunkDuration = Math.floor(actualDuration / Math.max(chunks.length, 1));

    for (let i = 0; i < chunks.length; i++) {
      entries.push({
        index: entries.length + 1,
        startMs: correctedStart + i * chunkDuration,
        endMs: Math.min(correctedStart + (i + 1) * chunkDuration, correctedStart + actualDuration),
        text: chunks[i],
      });
    }

    currentTime += sceneDurationMs;
  }

  const lines: string[] = [];
  for (const entry of entries) {
    const safeStartMs = Math.max(0, entry.startMs);
    const safeEndMs = Math.max(safeStartMs + 200, entry.endMs);
    lines.push(String(entry.index));
    lines.push(`${formatSrtTime(safeStartMs)} --> ${formatSrtTime(safeEndMs)}`);
    lines.push(entry.text);
    lines.push('');
  }

  return { entries, srtContent: lines.join('\n') };
}

export async function writeSrtFile(
  scenes: ScenePlan[],
  outputDir: string,
  filename: string,
  transitionDurationMs: number,
): Promise<string> {
  const { srtContent } = generateSubtitles(scenes, transitionDurationMs);
  const outputPath = join(outputDir, filename);
  await writeFile(outputPath, srtContent, 'utf-8');
  logger.info(`[RENDER_TRACE] SRT written: ${outputPath} (${scenes.length} scenes, transition correction: ${transitionDurationMs}ms)`);
  return outputPath;
}

export function generateSrtFilterPath(srtPath: string): string {
  const escapedPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  return escapedPath;
}
