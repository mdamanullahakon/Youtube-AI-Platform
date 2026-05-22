export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

export function calculateViralScore(
  trendMomentum: number,
  competitionLevel: number,
  audienceSize: number
): number {
  return Math.min(100, Math.round((trendMomentum * 0.4 + (100 - competitionLevel) * 0.3 + audienceSize * 0.3)));
}

export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export interface ParsedScene {
  text: string;
  duration: number;
  visualPrompt: string;
  mood?: string;
  pacing?: string;
  retentionHook?: string;
}

export async function detectGpuEncoder(ffmpegPath: string): Promise<'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'libx264'> {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    const { stdout } = await execAsync(`"${ffmpegPath}" -encoders 2>&1`, { timeout: 5000 });
    if (stdout.includes('h264_nvenc')) return 'h264_nvenc';
    if (stdout.includes('h264_qsv')) return 'h264_qsv';
    if (stdout.includes('h264_amf')) return 'h264_amf';
  } catch { /* fallback */ }
  return 'libx264';
}

export function isGpuAvailable(encoder: string): boolean {
  return encoder !== 'libx264';
}

export function parseScriptScenes(content: string): ParsedScene[] {
  const scenes: ParsedScene[] = [];
  const lines = content.split('\n');

  // Try format 1: [text|duration|visual]
  for (const line of lines) {
    if (line.includes('[AI_UNAVAILABLE]') || line.includes('AI_UNAVAILABLE')) continue;
    const match = line.match(/\[(.*?)\]/);
    if (match) {
      const parts = match[1].split('|').map(s => s.trim());
      scenes.push({
        text: parts[0] || 'Scene content',
        duration: Math.max(6, Math.min(parseInt(parts[1]?.match(/\d+/)?.[0] || '10'), 20)),
        visualPrompt: parts[2] || 'cinematic shot',
        mood: parts[3] || undefined,
        pacing: parts[4] || undefined,
        retentionHook: parts[5] || undefined,
      });
    }
  }

  if (scenes.length > 0) {
    for (const scene of scenes) {
      if (scene.duration < 6) scene.duration = 6;
    }
    return scenes;
  }

  // Try format 2: --- SECTION ---\ncontent blocks
  const sectionRegex = /^---\s*(.+?)\s*---/;
  let currentText: string[] = [];
  for (const line of lines) {
    if (sectionRegex.test(line)) {
      if (currentText.length > 0) {
        scenes.push({
          text: currentText.join(' ').trim(),
          duration: 18,
          visualPrompt: 'cinematic scene',
        });
        currentText = [];
      }
    } else if (line.trim()) {
      currentText.push(line.trim());
    }
  }
  if (currentText.length > 0) {
    scenes.push({
      text: currentText.join(' ').trim(),
      duration: 18,
      visualPrompt: 'cinematic scene',
    });
  }

  if (scenes.length > 0) {
    for (const scene of scenes) {
      if (scene.duration < 6) scene.duration = 6;
    }
    return scenes;
  }

  // Fallback: treat each paragraph as a scene
  const paragraphs = content.split('\n\n').filter(p => p.trim());
  for (const para of paragraphs) {
    scenes.push({
      text: para.trim().substring(0, 200),
      duration: 18,
      visualPrompt: 'cinematic shot',
    });
  }

  if (scenes.length === 0) {
    scenes.push({ text: content.substring(0, 100), duration: 30, visualPrompt: 'cinematic establishing shot' });
  }

  // Ensure minimum scene duration
  for (const scene of scenes) {
    if (scene.duration < 6) scene.duration = 6;
  }

  return scenes;
}
