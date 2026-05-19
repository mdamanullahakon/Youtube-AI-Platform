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

function escapeFilter(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'\\\\\\''")
    .replace(/%/g, '\\\\%')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/;/g, '\\;')
    .replace(/:/g, '\\:');
}

export function buildSceneFilter(
  sceneText: string,
  subtitleText: string,
  bgColor: string,
  accentColor: string,
  duration: number,
  fps: number,
  resolution: string,
  index: number,
  zoomDirection: 'in' | 'out' | 'none',
): string[] {
  const filters: string[] = [];

  // Base color source
  filters.push(`color=c=0x${bgColor}:s=${resolution}:d=${duration}:r=${fps}[base]`);

  // Accent gradient bar at top
  const accentOverlay =
    `color=c=0x${accentColor}:s=${resolution}:d=${duration}:r=${fps},` +
    `format=rgba,colorchannelmixer=aa=0.15[accent];` +
    `[base][accent]overlay=0:0[withaccent]`;

  filters.push(accentOverlay);

  // Subtle bottom bar
  const bottomBar =
    `color=c=black:s=${resolution}:d=${duration}:r=${fps},` +
    `format=rgba,colorchannelmixer=aa=0.3[bottom];` +
    `[withaccent][bottom]overlay=0:H-80[withbottom]`;

  filters.push(bottomBar);

  // Main text - centered
  const escapedText = escapeFilter(sceneText);
  const textLines = splitIntoLines(sceneText, 40);
  const textFilter = buildMultiLineDrawtext(textLines, duration, resolution, 48, 'main');
  filters.push(textFilter);

  // Subtitle at bottom
  const escapedSubtitle = escapeFilter(subtitleText);
  if (escapedSubtitle.length > 0) {
    // Animate subtitle: fade in over 0.5s
    const subtitleFilter =
      `[withbottom]drawtext=` +
      `text='${escapedSubtitle}':` +
      `x=(w-text_w)/2:` +
      `y=H-60:` +
      `fontsize=22:` +
      `fontcolor=white@0.7:` +
      `box=1:` +
      `boxcolor=black@0.3:` +
      `boxborderw=6:` +
      `alpha='if(lt(t,0.5),t/0.5,1)'` +
      `[v${index}]`;

    filters.push(subtitleFilter);
  }

  // Transition marker for concat
  filters.push(`[v${index}]copy[v${index}out]`);

  return filters;
}

export function buildTitleCardFilter(
  title: string,
  topic: string,
  duration: number,
  fps: number,
  resolution: string,
): string[] {
  const filters: string[] = [];
  const bgColor = '0a0a23';
  const accentColor = '1a1a5e';

  // Background with accent gradient
  filters.push(`color=c=0x${bgColor}:s=${resolution}:d=${duration}:r=${fps}[titlebase]`);

  // Accent overlay
  filters.push(
    `color=c=0x${accentColor}:s=${resolution}:d=${duration}:r=${fps},` +
    `format=rgba,colorchannelmixer=aa=0.2[titleaccent];` +
    `[titlebase][titleaccent]overlay=0:0[titlebg]`
  );

  // Animated accent line (draws from center outward)
  filters.push(
    `[titlebg]drawbox=` +
    `x='(w-400)/2':` +
    `y='h/2+40':` +
    `w='if(lt(t,0.5),400*t/0.5,400)':` +
    `h=3:` +
    `color=white@0.6` +
    `[titleline]`
  );

  // Title text - animated zoom in + fade
  const escapedTitle = escapeFilter((title || topic).replace(/:/g, '\uFF1A'));
  const titleFilter =
    `[titleline]drawtext=` +
    `text='${escapedTitle}':` +
    `x=(w-text_w)/2:` +
    `y='(h/2-text_h)/2':` +
    `fontsize=64:` +
    `fontcolor=white:` +
    `alpha='if(lt(t,1),t/1,1)':` +
    `shadowx=3:` +
    `shadowy=3:` +
    `shadowcolor=black@0.5` +
    `[titletitle]`;

  filters.push(titleFilter);

  // Topic subtitle
  if (topic && topic !== title) {
    const escapedTopic = escapeFilter(topic);
    const topicFilter =
      `[titletitle]drawtext=` +
      `text='${escapedTopic}':` +
      `x=(w-text_w)/2:` +
      `y='h/2+60':` +
      `fontsize=28:` +
      `fontcolor=white@0.6:` +
      `alpha='if(lt(t,1.5),(t-0.5)/1,1)'` +
      `[titleout]`;

    filters.push(topicFilter);
  }

  return filters;
}

export function buildConcatFilter(sceneCount: number): string {
  if (sceneCount === 1) return '[v0out]';

  const inputs: string[] = [];
  for (let i = 0; i < sceneCount; i++) {
    inputs.push(`[v${i}out]`);
  }
  return `${inputs.join('')}concat=n=${sceneCount}:v=1:a=0[final]`;
}

export function buildTransitionFilter(sceneCount: number, transitionDuration: number = 0.5): string {
  if (sceneCount <= 1) return '[v0]';

  // Use crossfade between consecutive scenes
  const parts: string[] = [];
  for (let i = 0; i < sceneCount - 1; i++) {
    const prevLabel = i === 0 ? `[v${i}]` : `[xf${i - 1}]`;
    const nextLabel = `[v${i + 1}]`;
    parts.push(
      `${prevLabel}${nextLabel}xfade=transition=fade:duration=${transitionDuration}:offset=${getTransitionOffset(i, transitionDuration)}[xf${i}]`
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

function splitIntoLines(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= maxCharsPerLine) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines;
}

function buildMultiLineDrawtext(
  lines: string[],
  duration: number,
  resolution: string,
  fontSize: number,
  label: string,
): string {
  const w = parseInt(resolution.split('x')[0] || '1920', 10);
  const h = parseInt(resolution.split('x')[1] || '1080', 10);
  const lineHeight = fontSize * 1.3;
  const totalTextHeight = lines.length * lineHeight;
  const startY = (h - totalTextHeight) / 2;

  const filterParts: string[] = [];

  lines.forEach((line, i) => {
    const escapedLine = escapeFilter(line);
    const yPos = startY + i * lineHeight;
    const fadeInDuration = Math.min(0.5, duration / 4);

    filterParts.push(
      `drawtext=` +
      `text='${escapedLine}':` +
      `x=(w-text_w)/2:` +
      `y=${yPos}:` +
      `fontsize=${fontSize}:` +
      `fontcolor=white:` +
      `box=1:` +
      `boxcolor=black@0.35:` +
      `boxborderw=12:` +
      `alpha='if(lt(t,${fadeInDuration}),t/${fadeInDuration},1)':` +
      `shadowx=2:` +
      `shadowy=2:` +
      `shadowcolor=black@0.3`
    );
  });

  return filterParts.join(',');
}

export function buildAudioMixFilter(hasVoiceover: boolean, voiceoverPath?: string): string[] {
  const filters: string[] = [];

  if (hasVoiceover && voiceoverPath) {
    // Voiceover is mixed in during the final concat step
    filters.push(`-i "${voiceoverPath}"`);
    filters.push(`-c:v copy -c:a aac -map 0:v:0 -map 1:a:0 -shortest`);
  } else {
    filters.push(`-c:v libx264 -preset ultrafast -crf 28`);
  }

  return filters;
}

export { escapeFilter, splitIntoLines };
