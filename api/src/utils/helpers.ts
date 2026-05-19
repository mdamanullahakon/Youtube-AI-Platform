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
}

export function parseScriptScenes(content: string): ParsedScene[] {
  const scenes: ParsedScene[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/\[(.*?)\]/);
    if (match) {
      const parts = match[1].split('|').map(s => s.trim());
      scenes.push({
        text: parts[0] || 'Scene content',
        duration: Math.max(6, Math.min(parseInt(parts[1]?.match(/\d+/)?.[0] || '10'), 20)),
        visualPrompt: parts[2] || 'cinematic shot',
      });
    }
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
