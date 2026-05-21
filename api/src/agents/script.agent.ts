import { generateWithAI } from '../services/ai.service';
import { aiLogger } from '../utils/logger';
import { ViralQualityEngine } from '../services/viral-quality.service';
import type { GeneratedScript, Scene } from '../types';

const MAX_TOTAL_MS = 300_000;
const CHUNK_TIMEOUT = 120_000;
const TARGET_SECONDS = 720;
const SCENE_SECONDS = 18;
const SCENE_COUNT = 40;
const MAX_SCENES = 60;
const viralEngine = new ViralQualityEngine();

async function generateChunk(prompt: string, label: string, timeout = CHUNK_TIMEOUT): Promise<string> {
  const start = Date.now();
  const fallbackText = (): string => {
    const fallbacks: Record<string, string> = {
      hook: 'What if everything you knew about this was completely wrong?',
      outline: '[The truth is more complex than most people realize | 18s | dramatic reveal scene]',
      cta: 'If this changed your perspective, subscribe and hit the bell for more eye-opening content every week.',
    };
    return fallbacks[label] || fallbacks.outline;
  };

  try {
    const remaining = Math.max(60000, timeout - (Date.now() - start));
    const result = await generateWithAI(prompt, 'ollama', { temperature: 0.8, timeout: remaining });
    if (result && result.trim()) return result;
    throw new Error('Empty response');
  } catch (err: any) {
    aiLogger.warn(`Chunk "${label}" failed (${err.message}), retrying with shorter prompt`);
    const shortPrompt = prompt.length > 200 ? prompt.slice(0, 200) : prompt;
    try {
      const remaining = Math.max(30000, timeout - (Date.now() - start));
      return await generateWithAI(shortPrompt, 'ollama', { temperature: 0.8, timeout: remaining });
    } catch {
      const fb = fallbackText();
      aiLogger.warn(`Chunk "${label}" using hardcoded fallback: "${fb.substring(0, 50)}"`);
      return fb;
    }
  }
}

export async function generateScript(
  topic: string,
  format: string = 'LongForm',
  competitorHooks?: string[]
): Promise<GeneratedScript> {
  const overallStart = Date.now();
  const isLongForm = format === 'LongForm' || format === 'Standard';
  const sceneCount = isLongForm ? SCENE_COUNT : 8;
  const sceneDuration = isLongForm ? SCENE_SECONDS : 15;
  const targetWords = isLongForm ? 2500 : 300;

  aiLogger.info(`Generating ${format} script for topic: ${topic} (${sceneCount} scenes, ~${(sceneCount * sceneDuration / 60).toFixed(0)}min target)`);
  const avoidHooks = competitorHooks?.length ? ` Avoid: ${JSON.stringify(competitorHooks.slice(0, 3))}.` : '';

  const hook = await generateHook(topic, avoidHooks, overallStart);
  if (Date.now() - overallStart > MAX_TOTAL_MS) return buildMinimalScript(topic, hook, format);

  const outlineText = await generateOutline(topic, hook, sceneCount, sceneDuration, isLongForm, avoidHooks, overallStart);
  if (Date.now() - overallStart > MAX_TOTAL_MS) {
    const scenes = parseScenes(outlineText, sceneCount * sceneDuration);
    const enforced = enforceViralArc(topic, hook, scenes, 'Subscribe for more!');
    return buildScriptContent(topic, hook, enforced, 'Subscribe for more!', format);
  }

  const cta = await generateCTA(topic, overallStart);

  let scenes = parseScenes(outlineText, sceneCount * sceneDuration);
  scenes = enforceViralArc(topic, hook, scenes, cta);

  if (isLongForm) {
    scenes = injectRetentionPatterns(scenes);
  }

  return buildScriptContent(topic, hook, scenes, cta, format);
}

async function generateHook(topic: string, avoidHooks: string, overallStart: number): Promise<string> {
  aiLogger.info('Generating hook...');
  let hook: string;
  let hookValid = false;
  let attempts = 0;

  do {
    const hookPrompt = [
      `Write a 3-4 sentence viral hook for a 10-15 minute video about "${topic}".`,
      'The hook MUST:',
      '- Open with a shocking or curiosity-grabbing statement in the first 3 words',
      '- Create an immediate open loop that demands closure',
      '- Hint at a secret, hidden truth, or counter-intuitive fact',
      '- End with a micro-cliffhanger that teases what follows',
      '- Use conversational, punchy language with natural pauses like ...',
      avoidHooks,
      'Return ONLY the hook text, no labels.',
    ].filter(Boolean).join('\n');

    hook = (await generateChunk(hookPrompt, 'hook', 90000))
      .replace(/^["']|["']$/g, '').replace(/^Hook:?/i, '').trim();

    const validation = viralEngine.validateHook(hook);
    hookValid = validation.valid;
    attempts++;

    if (!hookValid && attempts < 3) {
      aiLogger.warn(`Hook failed validation (score: ${validation.score}), retry ${attempts}/3`);
    }
  } while (!hookValid && attempts < 3);

  if (!hookValid) {
    hook = viralEngine.generateHook(topic, avoidHooks ? ['avoided'] : undefined).text;
    aiLogger.info(`Using engine-generated hook: "${hook.substring(0, 60)}..."`);
  }

  return hook;
}

async function generateOutline(
  topic: string,
  hook: string,
  sceneCount: number,
  sceneDuration: number,
  isLongForm: boolean,
  avoidHooks: string,
  overallStart: number,
): Promise<string> {
  aiLogger.info('Generating scene outlines...');

  const arcStructure = [
    'COLD OPEN — Hook + immediate curiosity gap (30s)',
    'THE SETUP — Context, stakes, what is at risk (60s)',
    'THE PROBLEM — Why conventional wisdom is wrong, expose hidden truth (90s)',
    'DEEP DIVE — Evidence, examples, case studies with emotional weight (180s)',
    'THE TWIST — Pattern interrupt, reveal counter-intuitive angle (60s)',
    'BUILD — Escalating tension, more evidence, mounting stakes (120s)',
    'SECOND TWIST — Another paradigm shift, deeper layer revealed (60s)',
    'CLIMAX — The big reveal, the solution, the truth (90s)',
    'PAYOFF — How this changes everything, transformation (60s)',
    'CTA — Subscribe, comment prompt, what to watch next (30s)',
  ];

  const pacingRules = [
    'Every 30-45 seconds: insert a pattern interrupt (new angle, surprising fact, visual change)',
    'Every 60-90 seconds: end with a micro-cliffhanger that pulls the viewer forward',
    'Use natural pauses marked as "..." in the spoken text',
    'Vary sentence length — short punchy statements mixed with flowing narrative',
    'Emotional shifts every 2-3 minutes: tension → curiosity → revelation → tension',
    'Each scene: [spoken narration text | duration in seconds | visual scene description]',
    'IMPORTANT: First scene after hook must deliver on the hook promise immediately',
  ];

  const outlinePrompt = [
    `You are writing a ${isLongForm ? '10-15 minute documentary-style' : 'short'} video script about "${topic}".`,
    `Hook: "${hook}"`,
    `Generate EXACTLY ${sceneCount} scenes. Each scene ${sceneDuration}s. Total: ~${(sceneCount * sceneDuration / 60).toFixed(0)} min.`,
    '',
    'ARC STRUCTURE (follow this pacing):',
    ...arcStructure.map(a => `  ${a}`),
    '',
    'PACING RULES (CRITICAL):',
    ...pacingRules.map(r => `  ${r}`),
    '',
    'TONE: Conversational, emotionally intelligent, like a master storyteller. NOT robotic.',
    'Use rhetorical questions. Use emphasis words like "absolutely", "completely", "nothing".',
    avoidHooks,
    '',
    `Return EXACTLY ${sceneCount} lines, one per scene, in this format:`,
    '[spoken text | seconds | visual description]',
    'NO extra text before or after.',
  ].join('\n');

  return await generateChunk(outlinePrompt, 'outline', 240000);
}

async function generateCTA(topic: string, overallStart: number): Promise<string> {
  aiLogger.info('Generating CTA...');
  const ctaPrompt = [
    `Write a 2-3 sentence call-to-action for a "${topic}" video.`,
    'Make it urgent and conversational, like a personal invitation.',
    'Include a specific comment prompt that sparks discussion.',
    'MUST include a clear subscription request (e.g. "subscribe for more")',
    'Return ONLY the CTA text, no labels.',
  ].join('\n');
  return (await generateChunk(ctaPrompt, 'cta', 60000))
    .replace(/^["']|["']$/g, '').trim();
}

function injectRetentionPatterns(scenes: Scene[]): Scene[] {
  const result: Scene[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    result.push(scene);

    if (result.length >= MAX_SCENES) break;

    if (i > 0 && i % 3 === 0 && i < scenes.length - 1) {
      result.push({
        text: 'But here is where it gets really interesting...',
        duration: 4,
        visualPrompt: 'pattern interrupt, dramatic shift, tension build',
      });
    }

    if (result.length >= MAX_SCENES) break;

    if (i > 0 && i % 5 === 0 && i < scenes.length - 2) {
      result.push({
        text: 'Wait... before we go further, there is something you need to understand first.',
        duration: 5,
        visualPrompt: 'direct address to camera, pause for emphasis',
      });
    }

    if (result.length >= MAX_SCENES) break;

    if (i > 0 && i % 8 === 0 && i < scenes.length - 1) {
      result.push({
        text: 'And this changes everything.',
        duration: 3,
        visualPrompt: 'cinematic reveal, music swell moment',
      });
    }

    if (result.length >= MAX_SCENES) break;

    if (i === Math.floor(scenes.length / 2)) {
      result.push({
        text: 'Now here is the part nobody talks about...',
        duration: 5,
        visualPrompt: 'tone shift, darker atmosphere, secret reveal',
      });
    }
  }

  return result;
}

function enforceViralArc(topic: string, hook: string, scenes: Scene[], cta: string): Scene[] {
  const result: Scene[] = [];

  const hookScene: Scene = {
    text: hook,
    duration: 12,
    visualPrompt: 'dramatic hook scene, curiosity gap, text overlay with bold typography',
  };
  result.push(hookScene);

  for (const scene of scenes) {
    const text = scene.text.toLowerCase().trim();
    if (text === hook.toLowerCase().trim()) continue;
    if (text.startsWith('[') && text.includes('hook')) continue;
    result.push({
      ...scene,
      duration: Math.min(Math.max(scene.duration, 6), 22),
    });
  }

  const joined = result.map(s => s.text.toLowerCase()).join(' ');
  const hasProblem = /problem|issue|mistake|wrong|challenge|struggle|but|however|unfortunately|truth|hidden|secret/.test(joined);
  const hasSolution = /solution|how to|fix|solve|step|guide|way to|method|proven|answer|reveal/.test(joined);

  if (!hasProblem && result.length < 15) {
    result.splice(3, 0, {
      text: `The real problem with ${topic} is much bigger than most people realize... and it affects you more than you think.`,
      duration: 12,
      visualPrompt: 'dramatic revelation, stakes escalation, serious tone',
    });
  }

  if (!hasSolution && result.length < 15) {
    result.splice(result.length - 2, 0, {
      text: `But here is the thing — there is a proven solution, and once you see it, you will wonder why nobody told you this before.`,
      duration: 10,
      visualPrompt: 'hopeful reveal, transformation visual, light emerging from dark',
    });
  }

  const ctaText = cta.toLowerCase().includes('subscribe') ? cta : `${cta}\n\nSubscribe for more strategies like this and hit the bell so you never miss an update.`;
  result.push({
    text: ctaText,
    duration: 8,
    visualPrompt: 'channel branding, subscribe button with animation, video suggestion cards',
  });

  return result;
}

function buildScriptContent(topic: string, hook: string, scenes: Scene[], cta: string, format: string): GeneratedScript {
  const sceneLines = scenes.map((s, i) => `[${s.text} | ${s.duration}s | ${s.visualPrompt}]`).join('\n');
  const content = `---HOOK---\n${hook}\n---SCENES---\n${sceneLines}\n---CTA---\n${cta}`;
  const wordCount = content.split(/\s+/).length;

  aiLogger.info(`Script generated: "${hook.substring(0, 60)}..." (${format}, ${wordCount} words, ${scenes.length} scenes, ~${(scenes.reduce((a, s) => a + s.duration, 0) / 60).toFixed(1)}min)`);

  return {
    content,
    hook,
    wordCount,
    tone: 'emotional-curiosity',
    targetLength: format,
    scenes,
  };
}

function buildMinimalScript(topic: string, hook: string, format: string): GeneratedScript {
  const scenes: Scene[] = [
    { text: hook, duration: 12, visualPrompt: 'dramatic hook' },
    { text: `Let me explain why ${topic} matters more than you think.`, duration: 15, visualPrompt: 'establishing shot' },
    { text: `The truth about ${topic} is surprising.`, duration: 15, visualPrompt: 'dramatic reveal' },
    { text: `But here is what nobody tells you about it.`, duration: 15, visualPrompt: 'secret reveal' },
    { text: `This is why it matters for your future.`, duration: 15, visualPrompt: 'future vision' },
    { text: `Subscribe for more content like this every week.`, duration: 8, visualPrompt: 'channel branding' },
  ];
  const cta = 'Subscribe for more content like this every week.';
  return buildScriptContent(topic, hook, scenes, cta, format);
}

function parseScenes(text: string, totalDuration: number): Scene[] {
  if (!text.trim()) {
    return [{ text: 'Main content', duration: Math.min(totalDuration / 8, 20), visualPrompt: 'cinematic establishing shot' }];
  }

  const scenes: Scene[] = [];
  const lines = text.split('\n').filter(l => l.trim());

  for (const line of lines) {
    const bracketMatch = line.match(/\[(.*?)\]/);
    if (bracketMatch) {
      const parts = bracketMatch[1].split('|').map(s => s.trim());
      scenes.push({
        text: parts[0] || 'Scene content',
        duration: Math.min(parseInt(parts[1]?.match(/\d+/)?.[0] || '15'), 25),
        visualPrompt: parts[2] || 'cinematic shot',
      });
    }
  }

  return scenes.length > 0 ? scenes : [{ text, duration: Math.min(totalDuration / 8, 20), visualPrompt: 'cinematic establishing shot' }];
}
