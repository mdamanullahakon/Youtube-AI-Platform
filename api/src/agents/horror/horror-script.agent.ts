import { generateWithAI } from '../../services/ai.service';
import { aiLogger } from '../../utils/logger';
import type { Scene } from '../../types';

const TARGET_SECONDS = 720;
const SCENE_SECONDS = 12;
const SCENE_COUNT = 60;

interface HorrorScriptResult {
  content: string;
  hook: string;
  wordCount: number;
  tone: string;
  scenes: Scene[];
  structure: {
    coldOpen: string;
    act1: string;
    act2: string;
    act3: string;
    climax: string;
    payoff: string;
  };
}

const ARC_STRUCTURE = [
  { name: 'COLD OPEN — Extreme Hook', duration: 12, desc: 'Most shocking 10 words possible. Fear + mystery. Ends on micro-cliffhanger.' },
  { name: 'THE INCIDENT — Setup', duration: 30, desc: 'The event that started it. Normal world → first crack of fear.' },
  { name: 'CREEPING DOUBT — Suspense Building', duration: 60, desc: 'Small details feel wrong. Subtle atmospheric dread. Open loop: "Something was off..."' },
  { name: 'FIRST TWIST — Pattern Interrupt', duration: 20, desc: 'First major shock/reveal. Audience gasps. Escalates stakes.' },
  { name: 'THE INVESTIGATION — Deep Dive', duration: 90, desc: 'Protagonist digs deeper. Each answer reveals 3 more questions.' },
  { name: 'SECOND TWIST — Escalation', duration: 25, desc: 'False explanation revealed as wrong. Real threat is WORSE.' },
  { name: 'DARKEST MOMENT — Despair', duration: 45, desc: 'Hope seems lost. Protagonist isolated. Tension max.' },
  { name: 'THE HIDDEN TRUTH — Revelation', duration: 35, desc: 'Layer peels back. The real horrifying truth emerges. Chilling.' },
  { name: 'FAKE RESOLUTION — False Safety', duration: 20, desc: 'Seems resolved. Characters breathe. Audience tricked into relief.' },
  { name: 'FINAL SHOCK — Ultimate Reveal', duration: 30, desc: 'The thing that changes EVERYTHING. Existential horror. Audience stunned.' },
  { name: 'EPILOGUE — Lingering Dread', duration: 25, desc: 'Not a happy ending. The horror continues. Stays with viewer.' },
  { name: 'CTA + NEXT TRAILER', duration: 15, desc: 'Subscribe for more horror. Tease next video. End with a jump-scare cut.' },
];

export async function generateHorrorScript(
  topic: string,
  previousHorrorTopics?: string[]
): Promise<HorrorScriptResult> {
  aiLogger.info(`Generating HORROR script: "${topic}" (${SCENE_COUNT} scenes, ~${(SCENE_COUNT * SCENE_SECONDS / 60).toFixed(0)}min target)`);

  const hook = await generateHorrorHook(topic);
  const acts = await generateHorrorActs(topic, hook);
  const scenes = assembleScenes(topic, hook, acts);
  const fullContent = buildContent(topic, hook, scenes, acts);

  const wordCount = fullContent.split(/\s+/).length;
  aiLogger.info(`Horror script complete: ${wordCount} words, ${scenes.length} scenes, ~${(scenes.reduce((s, a) => s + a.duration, 0) / 60).toFixed(0)}min`);

  return {
    content: fullContent,
    hook,
    wordCount,
    tone: 'horror-psychological',
    scenes,
    structure: acts,
  };
}

async function generateHorrorHook(topic: string): Promise<string> {
  const prompt = [
    'You are a master horror writer. Write a DEVASTATING cold open hook for a horror video.',
    '',
    `Topic: "${topic}"`,
    '',
    'RULES:',
    '- First 3 words must be the most terrifying opener possible',
    '- Create an immediate open loop that demands the viewer know more',
    '- Use short, punchy sentences. Silence between them.',
    '- End with a micro-cliffhanger that teases unspeakable horror',
    '- Do NOT use jump scares in text — use psychological dread',
    '- Make it feel REAL. First-person, confessional tone.',
    '- Examples: "I found something in the basement..." / "The last transmission was never explained." / "They said the house was empty."',
    '',
    'Return ONLY the hook text, 3-5 sentences maximum.',
  ].join('\n');

  try {
    const result = await generateWithAI(prompt, 'ollama', { temperature: 0.9, timeout: 90000 });
    const hook = result.replace(/^["']|["']$/g, '').replace(/^Hook:?/i, '').trim();
    return hook || `The last thing ${topic.split(' ').slice(0, 3).join(' ')} ever saw... was nothing at all.`;
  } catch {
    return `What they found in ${topic.split(' ').slice(0, 2).join(' ')} should never have been discovered. And now... it knows where you live.`;
  }
}

async function generateHorrorActs(
  topic: string,
  hook: string
): Promise<{ coldOpen: string; act1: string; act2: string; act3: string; climax: string; payoff: string }> {
  const defaultActs = () => ({
    coldOpen: `The night it happened, ${topic} was the last thing on anyone's mind. But by morning... nothing would ever be the same.`,
    act1: `It started with small things. A shadow that didn't match its owner. A whisper in an empty room. The kind of details you explain away — until you can't. ${topic} had been quiet for decades. But something was waking up.`,
    act2: `The investigation revealed impossible facts. Three separate witnesses, same story, no connection between them. Each one described ${topic} differently — yet the fear in their eyes was identical. The truth was buried beneath layers of denial. And what emerged was worse than any lie.`,
    act3: `Every door they opened led to a darker room. The evidence pointed to one conclusion — one so terrifying that even the researchers refused to say it aloud. ${topic} wasn't what they thought. It was a warning. And they were too late.`,
    climax: `Then came the revelation that broke them. The thing they thought was the threat... was only the messenger. The real horror was still coming. And it had been watching them since the very first day.`,
    payoff: `They escaped. But ${topic} doesn't leave you. It stays in your peripheral vision. In the silence between heartbeats. In the moment before sleep. They say it's over. But they're wrong. It's only just beginning.`,
  });

  try {
    const prompt = [
      'You are writing a Netflix-level horror documentary script.',
      '',
      `Topic: "${topic}"`,
      `Hook: "${hook}"`,
      '',
      'Write EXACTLY 6 acts for a 10-15 minute horror video.',
      'Each act 80-150 words. Make every sentence drive terror.',
      '',
      'ACT STRUCTURE:',
      '1. COLD OPEN — Extreme hook (12s of pure dread)',
      '2. ACT 1 — The setup, normal world, first cracks of fear (60s)',
      '3. ACT 2 — Investigation, impossible evidence, dread builds (120s)',
      '4. ACT 3 — Darkest revelation, everything they believed is wrong (90s)',
      '5. CLIMAX — The horrifying truth, chase/escape (60s)',
      '6. PAYOFF — Lingering horror, it is not over, stays with viewer (30s)',
      '',
      'TECHNIQUES:',
      '- Use "..." for suspense pauses',
      '- Short sentences for tension',
      '- Rhetorical questions that haunt',
      '- Sensory details (sound, cold, darkness, smell)',
      '- Psychological dread over gore',
      '- Realistic, grounded tone',
      '',
      'Return EXACTLY in this format (no extra text):',
      '---COLD_OPEN---',
      '[cold open text]',
      '---ACT1---',
      '[act 1 text]',
      '---ACT2---',
      '[act 2 text]',
      '---ACT3---',
      '[act 3 text]',
      '---CLIMAX---',
      '[climax text]',
      '---PAYOFF---',
      '[payoff text]',
    ].join('\n');

    const result = await generateWithAI(prompt, 'ollama', { temperature: 0.8, timeout: 600000 });
    return parseActs(result) || defaultActs();
  } catch {
    return defaultActs();
  }
}

function parseActs(text: string): { coldOpen: string; act1: string; act2: string; act3: string; climax: string; payoff: string } | null {
  const result: Record<string, string> = {};
  const sections = text.split('---').filter(s => s.trim());
  let currentKey = '';

  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed === 'COLD_OPEN') { currentKey = 'coldOpen'; continue; }
    if (trimmed === 'ACT1') { currentKey = 'act1'; continue; }
    if (trimmed === 'ACT2') { currentKey = 'act2'; continue; }
    if (trimmed === 'ACT3') { currentKey = 'act3'; continue; }
    if (trimmed === 'CLIMAX') { currentKey = 'climax'; continue; }
    if (trimmed === 'PAYOFF') { currentKey = 'payoff'; continue; }
    if (currentKey) result[currentKey] = trimmed;
  }

  return result.coldOpen && result.act1 && result.act2 && result.act3 && result.climax && result.payoff
    ? result as any
    : null;
}

function assembleScenes(topic: string, hook: string, acts: { coldOpen: string; act1: string; act2: string; act3: string; climax: string; payoff: string }): Scene[] {
  const scenes: Scene[] = [];
  let sceneIndex = 0;

  function addScene(text: string, duration: number, visualPrompt: string): void {
    scenes.push({ text, duration, visualPrompt });
  }

  function splitAct(text: string, baseDuration: number, visualPrompts: string[]): void {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const perSentence = Math.max(6, Math.floor(baseDuration / sentences.length));
    sentences.forEach((s, i) => {
      addScene(
        s.trim(),
        i === sentences.length - 1 ? perSentence + 2 : perSentence,
        visualPrompts[Math.min(i, visualPrompts.length - 1)]
      );
    });
  }

  addScene(hook, 12, 'Extreme close-up of terrified face, pitch black background, single flickering light source, text overlay fades in: "THE TRUTH"');

  splitAct(acts.coldOpen, 15, [
    'Handheld camera footage, dark room, flashlight beam cuts through darkness',
    'Slow zoom into a photograph, details emerging, eerie silence',
    'Static CCTV footage grain, timestamp flickering, shadow moves in frame',
  ]);

  splitAct(acts.act1, 60, [
    'Establishing shot: abandoned location, mist, moonlight through broken windows',
    'Slow pan across old photographs on a wall, faces blurred',
    'Close-up of a journal, handwriting, finger tracing words',
    'Night vision footage, trees moving in wind, distant figure',
    'Interior: dim lamp, dust particles in light beam, clock ticking',
  ]);

  splitAct(acts.act2, 90, [
    'Evidence board with photographs connected by red string, candle flickers',
    'Reenactment: someone walking down a dark hallway, doors slightly ajar',
    'Text message conversation appears on screen, words deleting themselves',
    'Security footage: timestamp skips forward, figure appears behind subject',
    'Audio waveform visualization, a whisper reversed plays',
    'Map with locations marked, zoom into a circled spot, red',
  ]);

  splitAct(acts.act3, 75, [
    'Rain on window, silhouette behind frosted glass, lightning flash reveals empty room',
    'Found footage: camera on floor, running footsteps, heavy breathing',
    'Basement stairs ascending into darkness, single lightbulb swings',
    'Medical diagram of brain, highlighted areas, text: "FEAR RESPONSE OVERRIDE"',
    'Mirror reflection: subject turns around, their reflection does not',
  ]);

  splitAct(acts.climax, 60, [
    'Rapid cuts: screaming face, dark hallway, running, falling',
    'POV shot running through forest at night, branches hitting camera',
    'Reveal shot: the thing. Shadow entity. Two glowing eyes. It smiles.',
    'Last frame: security cam footage, the entity walks TOWARD camera',
  ]);

  splitAct(acts.payoff, 30, [
    'Empty room. Morning light. Everything looks normal. Too normal.',
    'Slow zoom on a corner of the room. A shadow that should not be there.',
    'Final frame: black screen. White text fades in: "It is still watching."',
    'Jump scare cut to black with distorted sound',
  ]);

  addScene(
    'Subscribe if you want to sleep tonight. And whatever you do... do not watch the next video alone.',
    10,
    'Channel branding, subscribe button, "NEXT: The footage they tried to delete" with countdown, then a sudden glitch effect'
  );

  return scenes;
}

function buildContent(topic: string, hook: string, scenes: Scene[], acts: { coldOpen: string; act1: string; act2: string; act3: string; climax: string; payoff: string }): string {
  const sceneLines = scenes.map((s, i) =>
    `[${s.text} | ${s.duration}s | ${s.visualPrompt}]`
  ).join('\n');
  return [
    `---HOOK---`,
    hook,
    `---STRUCTURE---`,
    `Cold Open: ${acts.coldOpen}`,
    `Act 1: ${acts.act1}`,
    `Act 2: ${acts.act2}`,
    `Act 3: ${acts.act3}`,
    `Climax: ${acts.climax}`,
    `Payoff: ${acts.payoff}`,
    `---SCENES---`,
    sceneLines,
  ].join('\n');
}
