import { logger } from '../utils/logger';
import type { ParsedScene } from '../utils/helpers';

interface ViralHook {
  text: string;
  style: 'curiosity-gap' | 'shocking-fact' | 'question' | 'promise' | 'challenge' | 'numbers-list' | 'story' | 'urgency';
  emotion: 'shock' | 'curiosity' | 'urgency' | 'fear' | 'greed' | 'surprise';
}

const HOOK_TEMPLATES: ViralHook[] = [
  { text: "99% of people don't know this about {topic}", style: 'curiosity-gap', emotion: 'curiosity' },
  { text: "This {topic} secret is quietly making people rich", style: 'shocking-fact', emotion: 'greed' },
  { text: "You're losing money if you ignore this {topic} trend", style: 'urgency', emotion: 'fear' },
  { text: "I tried {topic} for 30 days — here's what happened", style: 'promise', emotion: 'curiosity' },
  { text: "This AI {topic} trick is illegal (but genius)", style: 'challenge', emotion: 'shock' },
  { text: "Stop doing {topic} wrong in 2026", style: 'challenge', emotion: 'urgency' },
  { text: "The {topic} hack that changed everything", style: 'curiosity-gap', emotion: 'surprise' },
  { text: "Why experts are scared of {topic} in 2026", style: 'shocking-fact', emotion: 'fear' },
  { text: "5 {topic} secrets they don't want you to know", style: 'numbers-list', emotion: 'curiosity' },
  { text: "What happens when {topic} goes mainstream?", style: 'question', emotion: 'curiosity' },
];

const EMOTIONAL_ARC_STEPS = ['hook', 'problem', 'agitation', 'solution', 'reward', 'call-to-action'] as const;

export class ViralQualityEngine {
  generateHook(topic: string, previousHooks: string[] = []): ViralHook {
    const available = HOOK_TEMPLATES.filter(h => {
      const filled = h.text.replace('{topic}', topic);
      return !previousHooks.some(ph => this.similarity(ph, filled) > 0.5);
    });

    if (available.length === 0) {
      return { text: `The truth about ${topic} nobody talks about`, style: 'curiosity-gap', emotion: 'curiosity' };
    }

    const pick = available[Math.floor(Math.random() * available.length)];
    return { ...pick, text: pick.text.replace('{topic}', topic) };
  }

  validateHook(hook: string): { valid: boolean; score: number; issues: string[] } {
    const issues: string[] = [];
    let score = 0;

    if (hook.length < 20) { issues.push('Hook too short (<20 chars)'); score -= 20; }
    if (hook.length > 150) { issues.push('Hook too long (>150 chars)'); score -= 10; }
    if (hook.includes('today we') || hook.includes('in this video') || hook.includes('we will')) {
      issues.push('Generic intro — must be specific/curiosity-driven'); score -= 30;
    }
    if (/[0-9]+/.test(hook)) score += 10;
    if (hook.includes('?') || hook.includes('!')) score += 10;
    if (hook.includes('you') || hook.includes('your')) score += 10;
    if (hook.includes('secret') || hook.includes('hidden') || hook.includes('nobody')) score += 15;
    if (hook.includes('2026') || hook.includes('this year')) score += 10;
    if (hook.includes('money') || hook.includes('rich') || hook.includes('losing')) score += 10;
    if (hook.includes('stop') || hook.includes('never') || hook.includes('don\'t')) score += 10;
    if (hook.includes('?')) score += 10;

    const totalScore = Math.max(0, Math.min(100, score + 50));
    return { valid: totalScore >= 50, score: totalScore, issues };
  }

  enforceEmotionalArc(scenes: ParsedScene[]): ParsedScene[] {
    if (!scenes.length) return scenes;

    // The first scene MUST be a hook
    const firstScene = scenes[0];

    // Check if first scene already reads like a hook
    const hookCheck = this.validateHook(firstScene.text);
    if (!hookCheck.valid) {
      // Force-generate a hook scene as the new first scene
      const hookScene: ParsedScene = {
        text: HOOK_TEMPLATES[Math.floor(Math.random() * HOOK_TEMPLATES.length)].text
          .replace('{topic}', firstScene.text.substring(0, 30)),
        duration: 10,
        visualPrompt: 'dramatic establishing shot, high contrast, curiosity, text overlay with bold words',
      };
      scenes = [hookScene, ...scenes];
    }

    // Ensure min 8 scenes
    while (scenes.length < 8) {
      const lastScene = scenes[scenes.length - 1];
      scenes.push({
        text: lastScene ? `${lastScene.text.substring(0, 40)} — continued with deeper insight` : 'Deep dive into the topic',
        duration: 8,
        visualPrompt: 'cinematic informational scene with data and visuals',
      });
    }

    // Check that scenes include an arc
    const joined = scenes.map(s => s.text.toLowerCase()).join(' ');
    const hasProblem = /problem|issue|mistake|wrong|challenge|struggle/.test(joined);
    const hasSolution = /solution|how to|fix|solve|step|guide|way to/.test(joined);
    const hasCta = /subscribe|comment|like|share|follow/.test(joined);

    if (!hasProblem && scenes.length >= 3) {
      // Inject a problem scene
      scenes.splice(1, 0, {
        text: `The real problem with ${scenes[0].text.substring(0, 30)} is worse than you think`,
        duration: 8,
        visualPrompt: 'dramatic revelation scene, concern and tension',
      });
    }

    if (!hasSolution && scenes.length >= 5) {
      scenes.splice(3, 0, {
        text: 'But there is a proven solution that most people overlook',
        duration: 8,
        visualPrompt: 'hopeful reveal, light emerging from darkness',
      });
    }

    if (!hasCta) {
      scenes.push({
        text: 'Subscribe for more strategies like this and hit the bell so you never miss an update',
        duration: 6,
        visualPrompt: 'channel branding, subscribe button visual with animation',
      });
    }

    return scenes;
  }

  optimizeScenePacing(scenes: ParsedScene[]): ParsedScene[] {
    const optimized: ParsedScene[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const duration = scene.duration;

      // First scene (hook): 8-12 seconds
      if (i === 0) {
        scene.duration = Math.min(Math.max(duration, 8), 12);
      }
      // Middle scenes: 6-10 seconds
      else if (i < scenes.length - 2) {
        scene.duration = Math.min(Math.max(duration, 6), 10);
      }
      // CTA scene: 5-8 seconds
      else if (i === scenes.length - 1) {
        scene.duration = Math.min(Math.max(duration, 5), 8);
      }
      // Reward/penultimate: 6-12 seconds
      else {
        scene.duration = Math.min(Math.max(duration, 6), 12);
      }

      // Vary pacing: don't let 3+ consecutive scenes have same duration
      if (i >= 2) {
        const prev = optimized[i - 1];
        const prev2 = optimized[i - 2];
        if (Math.abs(scene.duration - prev.duration) < 1 &&
            Math.abs(scene.duration - prev2.duration) < 1) {
          scene.duration = Math.max(6, scene.duration + (scene.duration >= 8 ? -2 : 2));
        }
      }

      optimized.push(scene);
    }

    return optimized;
  }

  checkVisualVariety(scenes: ParsedScene[]): { valid: boolean; issues: string[] } {
    const issues: string[] = [];
    const prompts = scenes.map(s => s.visualPrompt.toLowerCase());

    // Check for duplicate visual prompts
    const seen = new Set<string>();
    for (const p of prompts) {
      if (seen.has(p)) {
        issues.push('Duplicate visual prompt detected');
      }
      seen.add(p);
    }

    // Check for blank/black frame prompts
    for (const p of prompts) {
      if (p.includes('black') || p.includes('blank') || p.includes('empty') || p.length < 5) {
        issues.push(`Weak visual prompt: "${p}"`);
      }
    }

    // Check that at least 50% of scenes have zoom/motion
    const hasMotion = scenes.filter(s => s.visualPrompt.toLowerCase().includes('zoom') ||
      s.visualPrompt.toLowerCase().includes('pan') ||
      s.visualPrompt.toLowerCase().includes('motion') ||
      s.visualPrompt.toLowerCase().includes('transition')).length;
    if (hasMotion < scenes.length * 0.3) {
      issues.push('Too few scenes with zoom/pan/motion effects');
    }

    return { valid: issues.length <= 1, issues };
  }

  similarity(a: string, b: string): number {
    const shorter = a.length < b.length ? a : b;
    const longer = a.length < b.length ? b : a;
    if (longer.length === 0) return 1;
    const editDist = this.levenshtein(shorter, longer);
    return (longer.length - editDist) / longer.length;
  }

  private levenshtein(a: string, b: string): number {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = a[j - 1] === b[i - 1] ? 0 : 1;
        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
      }
    }
    return matrix[b.length][a.length];
  }
}
