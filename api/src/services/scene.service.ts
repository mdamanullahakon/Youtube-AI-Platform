import { logger } from '../utils/logger';
import type { ParsedScene } from '../utils/helpers';
import { ViralQualityEngine } from './viral-quality.service';

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

// ─── SAFETY LIMITS ───────────────────────────────────────────────────────────
const MAX_SCENE_DURATION = 16;
const MIN_SCENE_DURATION = 6;
const MAX_SCENES = 15;
const MIN_SCENES = 3;

const viralEngine = new ViralQualityEngine();

export async function planScenes(scenes: ParsedScene[], topic?: string): Promise<ScenePlan[]> {
  logger.info(`[RENDER_TRACE] Planning ${scenes.length} scenes for video`);

  // ─── EMPTY SCENE REJECTION ─────────────────────────────────────────────────
  const nonEmptyScenes = scenes.filter(s => s.text.trim().length > 0);
  if (nonEmptyScenes.length < scenes.length) {
    logger.warn(`[RENDER_TRACE] Rejected ${scenes.length - nonEmptyScenes.length} empty scenes`);
  }

  if (nonEmptyScenes.length < MIN_SCENES) {
    throw new Error(`Too few non-empty scenes: ${nonEmptyScenes.length} (minimum ${MIN_SCENES} required)`);
  }

  const limitedScenes = nonEmptyScenes.slice(0, MAX_SCENES);
  if (limitedScenes.length < nonEmptyScenes.length) {
    logger.warn(`[RENDER_TRACE] Truncated to ${MAX_SCENES} scenes (was ${nonEmptyScenes.length})`);
  }

  let enrichedScenes = limitedScenes;

  enrichedScenes = viralEngine.enforceEmotionalArc(enrichedScenes);
  logger.info('[VIRAL_QUALITY] Emotional arc enforced');

  enrichedScenes = viralEngine.optimizeScenePacing(enrichedScenes);
  logger.info('[VIRAL_QUALITY] Scene pacing optimized');

  const visualCheck = viralEngine.checkVisualVariety(enrichedScenes);
  if (!visualCheck.valid) {
    logger.warn(`[VIRAL_QUALITY] Visual variety issues: ${visualCheck.issues.join(', ')}`);
  }

  const plans: ScenePlan[] = [];
  const topicLower = (topic || '').toLowerCase();

  for (let i = 0; i < enrichedScenes.length; i++) {
    const scene = enrichedScenes[i];
    const palette = selectPalette(i, themeIndexFromTopic(topicLower, i));
    const zoom = ZOOM_OPTIONS[i % ZOOM_OPTIONS.length];

    // ─── SAFETY: enforce duration limits ────────────────────────────────────
    const duration = Math.max(MIN_SCENE_DURATION, Math.min(scene.duration || 10, MAX_SCENE_DURATION));

    let subtitle = scene.text;
    if (subtitle.length > 80) {
      subtitle = subtitle.substring(0, 77) + '...';
    }

    plans.push({
      index: i,
      text: scene.text,
      subtitle,
      duration,
      bgColor: palette.bgColor,
      accentColor: palette.accentColor,
      zoomDirection: duration < 4 ? 'none' : zoom,
      visualPrompt: scene.visualPrompt || palette.description,
    });
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
