import { extractJson } from '../utils/parse-ai-response';
import type { RetentionLoop, RetentionLoopType, PatternInterrupt } from '../types';
import { aiLogger } from '../utils/logger';
import { generateWithAI } from './ai.service';

interface RetentionPattern {
  type: RetentionLoopType;
  patterns: RegExp[];
  effectiveness: number;
}

const RETENTION_PATTERNS: RetentionPattern[] = [
  {
    type: 'pattern-interrupt',
    patterns: [
      /\b(but here's the thing|here's the kicker|wait for it|hold on|actually|the thing is|here's the problem)\b/i,
      /\b(not so fast|but wait|here's where it gets|and then this happened)\b/i,
    ],
    effectiveness: 0.9,
  },
  {
    type: 'curiosity-gap',
    patterns: [
      /\b(here's why|the reason|what happens next|you won't believe|what I discovered|the real reason)\b/i,
      /\b(but why|that's not all|there's more|and here's the best part)\b/i,
    ],
    effectiveness: 0.85,
  },
  {
    type: 'mini-cliffhanger',
    patterns: [
      /\b(but then|until one day|and that's when|what happened next|but that's not the end)\b/i,
      /\.\.\.$/m,
      /\b(to be continued|stay tuned|coming up next|right after this)\b/i,
    ],
    effectiveness: 0.9,
  },
  {
    type: 'promise-preview',
    patterns: [
      /\b(by the end of this|stick around|i'm going to show you|here's what you'll learn|today i'll)\b/i,
      /\b(in this video|throughout this|as we go|i'll reveal|you'll discover)\b/i,
    ],
    effectiveness: 0.75,
  },
  {
    type: 'question-pause',
    patterns: [
      /^(but why|how is that|what does that|does that mean|so what)/im,
      /\b(think about that|let that sink in|here's the question)\b/i,
    ],
    effectiveness: 0.7,
  },
  {
    type: 'stakes-raised',
    patterns: [
      /\b(this could mean|if this continues|the consequences|what's at stake|the difference between)\b/i,
      /\b(this changes everything|this is bigger than|the real cost|the price of)\b/i,
    ],
    effectiveness: 0.8,
  },
  {
    type: 'time-jump',
    patterns: [
      /\b(fast forward|days later|weeks passed|months went by|years later|the next day|immediately)\b/i,
      /\b(before we knew it|in that moment|suddenly|all of a sudden|out of nowhere)\b/i,
    ],
    effectiveness: 0.75,
  },
  {
    type: 'reveal-tease',
    patterns: [
      /\b(the truth is|what I found|the answer|here's the truth|the reality is|the secret)\b/i,
      /\b(coming up|what you're about to see|you'll never guess|wait till you hear)\b/i,
    ],
    effectiveness: 0.85,
  },
];

const PATTERN_INTERRUPT_PATTERNS = [
  { technique: 'visual-transition', patterns: [/\b(picture this|imagine|visualize|think about)\b/i], impact: 0.7 },
  { technique: 'rhetorical-question', patterns: [/\b(but what|how does|why would|does that|is it really)\b/i], impact: 0.6 },
  { technique: 'direct-address', patterns: [/\b(you might be thinking|you're probably wondering|if you're like me)\b/i], impact: 0.8 },
  { technique: 'analogy', patterns: [/\b(it's like|similar to|think of it as|imagine if|compare this to)\b/i], impact: 0.65 },
  { technique: 'counter-intuitive', patterns: [/\b(counterintuitive|surprisingly|oddly|strangely|ironically|contrary to)\b/i], impact: 0.85 },
  { technique: 'stat-reveal', patterns: [/\b(\d+%|1 in \d+|the number|statistics show|research shows|studies found)\b/i], impact: 0.75 },
  { technique: 'emotional-shift', patterns: [/\b(but here's the sad part|here's what's amazing|the most incredible part)\b/i], impact: 0.8 },
];

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 5);
}

export class RetentionLoopDetector {
  detectLoops(transcript: string): RetentionLoop[] {
    const loops: RetentionLoop[] = [];
    const sentences = splitIntoSentences(transcript);

    for (const [index, sentence] of sentences.entries()) {
      for (const { type, patterns, effectiveness } of RETENTION_PATTERNS) {
        for (const pattern of patterns) {
          if (pattern.test(sentence)) {
            loops.push({
              text: sentence.length > 120 ? sentence.substring(0, 117) + '...' : sentence,
              type,
              position: index,
              effectiveness: Math.round(effectiveness * 100),
            });
            break;
          }
        }
      }
    }

    return loops;
  }

  detectPatternInterrupts(transcript: string): PatternInterrupt[] {
    const interrupts: PatternInterrupt[] = [];
    const sentences = splitIntoSentences(transcript);

    for (const [index, sentence] of sentences.entries()) {
      for (const { technique, patterns, impact } of PATTERN_INTERRUPT_PATTERNS) {
        for (const pattern of patterns) {
          if (pattern.test(sentence)) {
            interrupts.push({
              text: sentence.length > 120 ? sentence.substring(0, 117) + '...' : sentence,
              technique,
              position: index,
              impact: Math.round(impact * 100),
            });
            break;
          }
        }
      }
    }

    return interrupts;
  }

  async enhanceWithAI(transcript: string, loops: RetentionLoop[], interrupts: PatternInterrupt[]): Promise<{
    loops: RetentionLoop[];
    interrupts: PatternInterrupt[];
  }> {
    try {
      const midSection = transcript.substring(
        Math.floor(transcript.length * 0.2),
        Math.floor(transcript.length * 0.8)
      ).substring(0, 1500);

      const prompt = `Analyze this YouTube transcript for retention techniques and pattern interrupts.

Mid-section:
"""${midSection}"""

Detected so far: ${JSON.stringify({ loops: loops.slice(0, 3), interrupts: interrupts.slice(0, 3) })}

Return JSON: {
  "loops": [
    {
      "text": "exact sentence",
      "type": "pattern-interrupt|curiosity-gap|mini-cliffhanger|promise-preview|question-pause|stakes-raised|time-jump|reveal-tease",
      "position": 5,
      "effectiveness": 85
    }
  ],
  "interrupts": [
    {
      "text": "exact sentence",
      "technique": "visual-transition|rhetorical-question|direct-address|analogy|counter-intuitive|stat-reveal|emotional-shift",
      "position": 3,
      "impact": 80
    }
  ]
}

Focus on mid-video retention patterns that keep viewers watching past the first 30 seconds. Score effectiveness/impact 0-100.`;

      const result = await generateWithAI(prompt, 'ollama', { temperature: 0.3 });
      const parsed = extractJson(result) as any;

      const mergedLoops = new Map<string, RetentionLoop>();
      if (Array.isArray(parsed.loops)) {
        for (const l of parsed.loops as RetentionLoop[]) {
          const key = l.text.substring(0, 40);
          if (!mergedLoops.has(key)) {
            mergedLoops.set(key, { ...l, text: l.text.substring(0, 120) });
          }
        }
      }
      for (const l of loops) {
        const key = l.text.substring(0, 40);
        if (!mergedLoops.has(key)) {
          mergedLoops.set(key, l);
        }
      }

      const mergedInterrupts = new Map<string, PatternInterrupt>();
      if (Array.isArray(parsed.interrupts)) {
        for (const i of parsed.interrupts as PatternInterrupt[]) {
          const key = i.text.substring(0, 40);
          if (!mergedInterrupts.has(key)) {
            mergedInterrupts.set(key, { ...i, text: i.text.substring(0, 120) });
          }
        }
      }
      for (const i of interrupts) {
        const key = i.text.substring(0, 40);
        if (!mergedInterrupts.has(key)) {
          mergedInterrupts.set(key, i);
        }
      }

      return {
        loops: Array.from(mergedLoops.values()).sort((a, b) => a.position - b.position),
        interrupts: Array.from(mergedInterrupts.values()).sort((a, b) => a.position - b.position),
      };
    } catch (err) {
      aiLogger.warn('AI retention enhancement failed, using rule-based results', { error: (err as Error).message });
      return { loops, interrupts };
    }
  }
}
