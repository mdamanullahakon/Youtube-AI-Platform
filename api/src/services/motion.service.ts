import { logger } from '../utils/logger';

interface MotionGraphicsOptions {
  title?: string;
  topic?: string;
  totalDuration: number;
  resolution: string;
}

interface MotionFilter {
  name: string;
  filterChain: string[];
}

export function escapeFilter(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '\u2019')
    .replace(/"/g, '\u201D')
    .replace(/\n/g, '\\n')
    .replace(/%/g, '\\\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/;/g, '\\;')
    .replace(/\r/g, '')
    .replace(/:/g, '\uFF1A');
}

export function buildConcatFilter(sceneCount: number): string {
  if (sceneCount === 1) return '[v0]';

  const inputs: string[] = [];
  for (let i = 0; i < sceneCount; i++) {
    inputs.push(`[v${i}]`);
  }
  return `${inputs.join('')}concat=n=${sceneCount}:v=1:a=0[final]`;
}

export function buildTransitionFilter(sceneCount: number, transitionDuration: number = 0.4): string {
  if (sceneCount <= 1) return '[v0]';

  const parts: string[] = [];
  for (let i = 0; i < sceneCount - 1; i++) {
    const prevLabel = i === 0 ? `[v${i}]` : `[xf${i - 1}]`;
    const nextLabel = `[v${i + 1}]`;
    parts.push(
      `${prevLabel}${nextLabel}xfade=transition=fade:duration=${transitionDuration}:offset=${getTransitionOffset(i, transitionDuration)}[xf${i}]`,
    );
  }

  if (parts.length === 0) return '[v0]';
  return parts.join(';');
}

function getTransitionOffset(sceneIndex: number, transitionDuration: number): string {
  let offset = 0;
  for (let i = 0; i <= sceneIndex; i++) {
    if (i > 0) offset += transitionDuration;
  }
  return String(offset);
}

export function buildAudioMixFilter(hasVoiceover: boolean, voiceoverPath?: string): string[] {
  const filters: string[] = [];

  if (hasVoiceover && voiceoverPath) {
    filters.push(`-i "${voiceoverPath}"`);
    filters.push(`-c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest`);
  } else {
    filters.push(`-c:v libx264 -preset ultrafast -crf 28`);
  }

  return filters;
}

// splitIntoLines functionality moved inline in render.service.ts
