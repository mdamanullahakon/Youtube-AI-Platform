import { generateWithAI } from './ai.service';
import { aiLogger } from '../utils/logger';
import { extractJson } from '../utils/parse-ai-response';
import type { DetectedHook, HookType } from '../types';

interface HookPattern {
  type: HookType;
  patterns: RegExp[];
  weight: number;
}

const HOOK_PATTERNS: HookPattern[] = [
  {
    type: 'curiosity-gap',
    patterns: [
      /\b(what happens?|the reason|here's why|the truth about|what they don't tell you|the real reason|why I|the secret behind)\b/i,
      /\b(you won't believe|wait until you|here's what|nobody tells you|what nobody knows)\b/i,
      /\b(this is why|the moment I|what I discovered|the one thing|how I almost)\b/i,
    ],
    weight: 1.0,
  },
  {
    type: 'pattern-interrupt',
    patterns: [
      /\b(stop|wait|hold on|but here's the thing|here's the kicker|actually|here's the problem)\b/i,
      /^(but|however|despite|unless|imagine|picture this)/im,
      /\b(let me ask you|here's what's crazy|the thing is)\b/i,
    ],
    weight: 0.9,
  },
  {
    type: 'provocative-question',
    patterns: [
      /^(what|why|how|who|when|where|do you|are you|have you|did you|can you|should you)/im,
      /\b(what if|why do|how would|have you ever|did you know)\b/i,
    ],
    weight: 0.85,
  },
  {
    type: 'bold-statement',
    patterns: [
      /\b(this is the|this changes|nothing like|completely|totally|absolutely|the most|the best|the worst|the only)\b/i,
      /^(i'm going to show you|i discovered|i found|here's the truth)/im,
    ],
    weight: 0.8,
  },
  {
    type: 'shocking-statistic',
    patterns: [
      /\d+%/,
      /\d+ (million|billion|trillion|thousand|years|days|hours|minutes|people|users|views|dollars)/i,
      /\b(more than|over|under|less than) \d+/i,
    ],
    weight: 0.95,
  },
  {
    type: 'story-bait',
    patterns: [
      /\b(let me tell you|i remember|back when|the day I|the moment|my story|here's what happened)\b/i,
      /^(i was|we were|she was|he was|they were|it started)/im,
    ],
    weight: 0.75,
  },
  {
    type: 'benefit-forward',
    patterns: [
      /\b(how to|learn to|master|discover|unlock|transform|supercharge|skyrocket)\b/i,
      /\b(increase|boost|improve|double|triple|maximize|optimize)\b/i,
    ],
    weight: 0.7,
  },
  {
    type: 'urgency',
    patterns: [
      /\b(now|today|limited|before it's|last chance|hurry|act now|don't miss|expires|deadline)\b/i,
      /\b(right now|as we speak|this moment|immediately|urgent)\b/i,
    ],
    weight: 0.65,
  },
  {
    type: 'controversy',
    patterns: [
      /\b(controversial|unpopular opinion|hot take|debate|wrong about|myth|debunked|truth everyone ignores)\b/i,
      /\b(why everyone|why nobody|what they're not telling you|the lie about)\b/i,
    ],
    weight: 0.85,
  },
  {
    type: 'relatable-problem',
    patterns: [
      /\b(we've all|everyone|nobody likes|hate when|struggle with|frustrating|annoying|tired of)\b/i,
      /\b(you know that feeling|have you ever felt|we all know)\b/i,
    ],
    weight: 0.7,
  },
];

function detectHookType(text: string): { type: HookType; score: number; reason: string } {
  let bestType: HookType = 'unknown';
  let bestScore = 0;
  let bestReason = '';

  for (const { type, patterns, weight } of HOOK_PATTERNS) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const matchScore = weight * (match[0].length / text.length + 0.5);
        if (matchScore > bestScore) {
          bestType = type;
          bestScore = matchScore;
          bestReason = `Matches "${match[0].trim()}" pattern for ${type}`;
        }
      }
    }
  }

  if (bestType === 'unknown') {
    bestReason = 'No specific hook pattern detected';
    bestScore = 0.1;
  }

  return { type: bestType, score: Math.min(1, bestScore), reason: bestReason };
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
}

function splitIntoChunks(text: string, maxWords: number = 30): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(' '));
  }
  return chunks;
}

export class ViralHookDetector {
  async detectHooks(transcript: string): Promise<DetectedHook[]> {
    const hooks: DetectedHook[] = [];
    const sentences = splitIntoSentences(transcript);

    for (const [index, sentence] of sentences.entries()) {
      const { type, score, reason } = detectHookType(sentence);
      if (type !== 'unknown' || index < 5) {
        hooks.push({
          text: sentence.length > 150 ? sentence.substring(0, 147) + '...' : sentence,
          type,
          position: index,
          score: Math.round(score * 100),
          reason,
        });
      }
    }

    hooks.sort((a, b) => b.score - a.score);

    return hooks.slice(0, 15);
  }

  async enhanceWithAI(transcript: string, detected: DetectedHook[]): Promise<DetectedHook[]> {
    try {
      const first2000 = transcript.substring(0, 2000);
      const prompt = `Analyze this YouTube transcript opening and identify viral hook patterns.

Transcript opening:
"""${first2000}"""

Current detections: ${JSON.stringify(detected.slice(0, 5))}

Return JSON: {
  "hooks": [
    {
      "text": "exact hook sentence",
      "type": "curiosity-gap|pattern-interrupt|provocative-question|bold-statement|shocking-statistic|story-bait|benefit-forward|urgency|controversy|relatable-problem",
      "position": 0,
      "score": 85,
      "reason": "why this is a hook"
    }
  ]
}

Focus on the FIRST 3 sentences — they are the most critical for retention. Score each 0-100.`;

      const result = await generateWithAI(prompt, 'ollama', { temperature: 0.3 });
      const parsed = extractJson(result) as any;

      if (Array.isArray(parsed.hooks)) {
        const aiHooks: DetectedHook[] = parsed.hooks.map((h: any) => ({
          text: h.text?.substring(0, 150) || '',
          type: h.type || 'unknown',
          position: h.position ?? 0,
          score: Math.min(100, Math.max(0, h.score ?? 50)),
          reason: h.reason || 'AI-detected hook pattern',
        }));

        const merged = new Map<string, DetectedHook>();
        for (const h of [...aiHooks, ...detected]) {
          const key = h.text.substring(0, 40);
          if (!merged.has(key) || merged.get(key)!.score < h.score) {
            merged.set(key, h);
          }
        }

        return Array.from(merged.values())
          .sort((a, b) => a.position - b.position)
          .slice(0, 15);
      }
    } catch (err) {
      aiLogger.warn('AI hook enhancement failed, using rule-based results', { error: (err as Error).message });
    }

    return detected;
  }
}
