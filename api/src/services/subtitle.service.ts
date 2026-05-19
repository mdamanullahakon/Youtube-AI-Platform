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

function formatSrtTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.floor(ms % 1000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

export function generateSubtitles(scenes: ScenePlan[]): {
  entries: SubtitleEntry[];
  srtContent: string;
} {
  const entries: SubtitleEntry[] = [];
  let currentTime = 0;

  for (const scene of scenes) {
    const sceneDurationMs = scene.duration * 1000;

    // Split long text into multiple subtitle chunks per scene
    const chunks = splitSubtitleText(scene.text, 50);
    const chunkDuration = Math.floor(sceneDurationMs / Math.max(chunks.length, 1));

    for (let i = 0; i < chunks.length; i++) {
      entries.push({
        index: entries.length + 1,
        startMs: currentTime + i * chunkDuration,
        endMs: Math.min(currentTime + (i + 1) * chunkDuration, currentTime + sceneDurationMs),
        text: chunks[i],
      });
    }

    currentTime += sceneDurationMs;
  }

  // Build SRT content
  const lines: string[] = [];
  for (const entry of entries) {
    lines.push(String(entry.index));
    lines.push(`${formatSrtTime(entry.startMs)} --> ${formatSrtTime(entry.endMs)}`);
    lines.push(entry.text);
    lines.push('');
  }

  return { entries, srtContent: lines.join('\n') };
}

export async function writeSrtFile(scenes: ScenePlan[], outputDir: string, filename: string = 'subtitles.srt'): Promise<string> {
  const { srtContent } = generateSubtitles(scenes);
  const outputPath = join(outputDir, filename);
  await writeFile(outputPath, srtContent, 'utf-8');
  logger.info(`SRT file written: ${outputPath}`);
  return outputPath;
}

export function generateSrtFilterPath(srtPath: string): string {
  // Escape for FFmpeg filter chain
  const escapedPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  return escapedPath;
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
      // If a single sentence is too long, split by words
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
