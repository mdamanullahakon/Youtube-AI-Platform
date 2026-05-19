import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import type { ParsedScene } from '../utils/helpers';
import { extractJsonArray } from '../utils/parse-ai-response';

export interface ScenePlan {
  index: number;
  text: string;
  subtitle: string;
  duration: number;
  bgColor: string;
  accentColor: string;
  zoomDirection: 'in' | 'out' | 'none';
  visualPrompt: string;
}

interface SceneTheme {
  bgColor: string;
  accentColor: string;
  description: string;
}

const THEME_PALETTES: SceneTheme[] = [
  { bgColor: '0a0a23', accentColor: '1a1a5e', description: 'dark blue, tech/modern' },
  { bgColor: '1a0a2e', accentColor: '3a1a6e', description: 'deep purple, creative' },
  { bgColor: '0a1a2e', accentColor: '1a3a5e', description: 'navy blue, professional' },
  { bgColor: '2e1a0a', accentColor: '5e3a1a', description: 'warm brown, earthy' },
  { bgColor: '0a2e1a', accentColor: '1a5e3a', description: 'forest green, nature' },
  { bgColor: '2e0a0a', accentColor: '5e1a1a', description: 'dark red, urgent' },
  { bgColor: '1a1a1a', accentColor: '3a3a3a', description: 'charcoal, minimalist' },
  { bgColor: '0a1a1a', accentColor: '1a3a3a', description: 'teal dark, calm' },
  { bgColor: '1a0a1a', accentColor: '3a1a3a', description: 'mauve dark, elegant' },
  { bgColor: '0a0a0a', accentColor: '1a1a1a', description: 'pure black, dramatic' },
];

const ZOOM_OPTIONS: ScenePlan['zoomDirection'][] = ['in', 'out', 'none', 'in', 'out'];

export async function planScenes(scenes: ParsedScene[], topic?: string): Promise<ScenePlan[]> {
  logger.info(`Planning ${scenes.length} scenes for video`);

  const plans: ScenePlan[] = [];
  const topicLower = (topic || '').toLowerCase();

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const palette = selectPalette(i, themeIndexFromTopic(topicLower, i));
    const zoom = ZOOM_OPTIONS[i % ZOOM_OPTIONS.length];

    let subtitle = scene.text;
    if (subtitle.length > 80) {
      subtitle = subtitle.substring(0, 77) + '...';
    }

    plans.push({
      index: i,
      text: scene.text,
      subtitle,
      duration: Math.max(6, Math.min(scene.duration || 10, 20)),
      bgColor: palette.bgColor,
      accentColor: palette.accentColor,
      zoomDirection: zoom,
      visualPrompt: scene.visualPrompt || palette.description,
    });
  }

  // Use AI to enhance scene descriptions if visualPrompt is generic
  try {
    const enhanced = await enhanceScenesWithAI(plans, topic);
    if (enhanced) return enhanced;
  } catch {
    logger.warn('AI scene enhancement unavailable, using defaults');
  }

  return plans;
}

function selectPalette(index: number, baseIndex: number): SceneTheme {
  const idx = (baseIndex + index) % THEME_PALETTES.length;
  return THEME_PALETTES[idx];
}

function themeIndexFromTopic(topic: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < topic.length; i++) {
    hash = ((hash << 5) - hash) + topic.charCodeAt(i);
  }
  return Math.abs(hash) % THEME_PALETTES.length;
}

async function enhanceScenesWithAI(plans: ScenePlan[], topic?: string): Promise<ScenePlan[] | null> {
  const firstPlan = plans[0];
  if (!firstPlan) return null;

  const prompt = `You are a video scene planner. For a faceless video about "${topic || 'content'}", analyze these scenes and respond with a JSON array ONLY (no other text).

For each scene, provide:
- "bgColor": a hex color (6 chars, no #) that fits the scene mood
- "accentColor": a lighter/different hex color for gradients
- "subtitle": a short subtitle text (max 80 chars) summarizing the scene

Scenes:
${plans.map((p, i) => `Scene ${i + 1}: "${p.text.substring(0, 100)}" (${p.duration}s)`).join('\n')}

Return ONLY a JSON array: [{"bgColor":"...", "accentColor":"...", "subtitle":"..."}]`;

  const response = await generateWithAI(prompt, 'ollama', { temperature: 0.3, timeout: 60000 });

  try {
    const enhancements = extractJsonArray<{ bgColor?: string; accentColor?: string; subtitle?: string }>(response);

    if (enhancements && enhancements.length === plans.length) {
      return plans.map((plan, i) => {
        const e = enhancements[i];
        return {
          ...plan,
          bgColor: e.bgColor && /^[0-9a-f]{6}$/i.test(e.bgColor) ? e.bgColor : plan.bgColor,
          accentColor: e.accentColor && /^[0-9a-f]{6}$/i.test(e.accentColor) ? e.accentColor : plan.accentColor,
          subtitle: e.subtitle || plan.subtitle,
        };
      });
    }
  } catch {
    // AI response wasn't valid JSON, use defaults
  }

  return null;
}
