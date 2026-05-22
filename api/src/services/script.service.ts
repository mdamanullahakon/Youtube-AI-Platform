// Simple script generation service — enhanced with LLM fallback
import { generateText } from './llm.service';

export type ScriptOptions = {
  topic: string;
  language?: string; // 'en' | 'bn' etc.
  tone?: string;
  length?: 'short' | 'medium' | 'long'; // 60s, 5min, 10min
};

async function generateScriptWithLLM(opts: ScriptOptions): Promise<string> {
  const lengths: Record<string, number> = { short: 60, medium: 300, long: 600 };
  const targetDuration = lengths[opts.length || 'short'];

  const prompt = `Write a viral YouTube script about "${opts.topic}" (${opts.language || 'English'}, ${opts.tone || 'engaging'}).
Target duration: ~${targetDuration} seconds.
Format as a clear script with:
- HOOK (first 5 seconds, curiosity-driven)
- INTRO (context)
- BODY (main points, 3-5 sections)
- OUTRO (summary + CTA)

Make it conversational, engaging, and optimized for retention.`;

  try {
    return await generateText(prompt, { maxTokens: 2048, temperature: 0.7 });
  } catch (err) {
    console.warn('[ScriptEngine] LLM generation failed, using template');
    return generateScriptTemplate(opts);
  }
}

function generateScriptTemplate(opts: ScriptOptions): string {
  const hook = `HOOK: "${opts.topic}" — the one thing you NEED to know.`;
  const intro = `INTRO: Today, we're diving deep into ${opts.topic}. By the end of this video, you'll understand exactly how to...`;
  const body = `BODY:\n- Point 1: What is ${opts.topic}?\n- Point 2: Why does it matter?\n- Point 3: How to use it?\n- Point 4: Real-world examples`;
  const outro = `OUTRO: Now you know ${opts.topic}! Like this video if you found it helpful, subscribe for more, and let me know in the comments what you'd like to see next.`;

  return [hook, intro, body, outro].join('\n\n');
}

export async function generateScript(opts: ScriptOptions): Promise<string> {
  return generateScriptWithLLM(opts);
}

export default { generateScript };