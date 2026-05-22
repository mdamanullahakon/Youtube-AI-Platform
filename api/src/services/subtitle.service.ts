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
// Expanded set of power words including horror-specific emotional triggers
const POWER_WORDS = new Set([
  'secret', 'hidden', 'shocking', 'never', 'always', 'truth', 'danger', 'deadly',
  'insane', 'crazy', 'million', 'billion', 'free', 'urgent', 'warning', 'revealed',
  // Horror‑specific emotional words
  'blood', 'shadow', 'terror', 'silence', 'scream', 'haunted', 'creepy', 'nightmare',
]);

/** Wrap power words for ASS highlight (yellow bold) */
export function highlightSubtitleText(text: string): string {
  return text.split(/(\s+)/).map(part => {
    const clean = part.replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (clean.length > 3 && POWER_WORDS.has(clean)) {
      return `{\\b1\\c&H0000FFFF&}${part}{\\r}`;
    }
    return part;
  }).join('');
}

export function getSubtitleStyle(mood: string = 'story'): string {
  const isDark = mood === 'dark' || mood === 'suspense';
  return [
    'Alignment=2',
    'FontName=Arial',
    'FontSize=26',
    isDark ? 'PrimaryColour=&H00E0E0FF' : 'PrimaryColour=&H00FFFFFF',
    'OutlineColour=&H80000000',
    'BackColour=&H64000000',
    'BorderStyle=1',
    'Outline=2',
    'Shadow=2',
    'MarginV=55',
    'Bold=1',
    'WrapStyle=2',
  ].join(',');
}

function splitSubtitleText(text: string, maxCharsPerChunk: number): string[] {
  const words = text.split(' ');
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length <= maxCharsPerChunk) {
      current += (current ? ' ' : '') + word;
    } else {
      if (current) chunks.push(current.trim());
      current = word;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}

function formatSrtTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.floor(ms % 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
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
        text: highlightSubtitleText(chunks[i]),
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
