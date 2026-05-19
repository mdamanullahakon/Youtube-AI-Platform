import { generateWithAI } from './ai.service';
import { aiLogger } from '../utils/logger';
import type { StorytellingStructure, StoryPhase, EmotionalArc, EmotionalPoint } from '../types';

interface StructureTemplate {
  name: string;
  arc: string;
  phases: { name: string; purpose: string; expectedPosition: number }[];
}

const STRUCTURE_TEMPLATES: StructureTemplate[] = [
  {
    name: 'problem-solution',
    arc: 'setup → conflict → resolution',
    phases: [
      { name: 'Problem Introduction', purpose: 'Present a relatable problem or pain point', expectedPosition: 0 },
      { name: 'Stakes Escalation', purpose: 'Show consequences of not solving the problem', expectedPosition: 0.25 },
      { name: 'Solution Reveal', purpose: 'Present the solution or discovery', expectedPosition: 0.5 },
      { name: 'Results & Benefits', purpose: 'Show transformation and outcomes', expectedPosition: 0.7 },
      { name: 'Call to Action', purpose: 'Encourage adoption or action', expectedPosition: 0.9 },
    ],
  },
  {
    name: 'hook-story-payoff',
    arc: 'hook → story → payoff',
    phases: [
      { name: 'Hook', purpose: 'Capture attention with curiosity or bold claim', expectedPosition: 0 },
      { name: 'Setup', purpose: 'Provide context and background', expectedPosition: 0.1 },
      { name: 'Rising Tension', purpose: 'Build suspense or intrigue', expectedPosition: 0.3 },
      { name: 'Climax', purpose: 'Deliver the key revelation or turning point', expectedPosition: 0.6 },
      { name: 'Payoff', purpose: 'Provide resolution and value', expectedPosition: 0.8 },
    ],
  },
  {
    name: 'list-format',
    arc: 'promise → items → summary',
    phases: [
      { name: 'Promise Hook', purpose: 'State what the viewer will learn', expectedPosition: 0 },
      { name: 'Item 1', purpose: 'First point or technique', expectedPosition: 0.15 },
      { name: 'Middle Items', purpose: 'Subsequent points with examples', expectedPosition: 0.3 },
      { name: 'Final Item', purpose: 'Most impactful point saved for last', expectedPosition: 0.75 },
      { name: 'Summary & CTA', purpose: 'Recap key takeaways', expectedPosition: 0.9 },
    ],
  },
  {
    name: 'curiosity-gap',
    arc: 'mystery → exploration → reveal',
    phases: [
      { name: 'Mystery Hook', purpose: 'Pose a question or introduce a mystery', expectedPosition: 0 },
      { name: 'False Trails', purpose: 'Explore potential answers that are wrong', expectedPosition: 0.2 },
      { name: 'Clues', purpose: 'Build evidence toward the real answer', expectedPosition: 0.4 },
      { name: 'Big Reveal', purpose: 'Answer the mystery with a surprising twist', expectedPosition: 0.7 },
      { name: 'Implications', purpose: 'Explain why this matters', expectedPosition: 0.85 },
    ],
  },
  {
    name: 'rags-to-riches',
    arc: 'struggle → breakthrough → success',
    phases: [
      { name: 'Low Point', purpose: 'Describe the struggle or failure', expectedPosition: 0 },
      { name: 'Turning Point', purpose: 'The moment everything changed', expectedPosition: 0.35 },
      { name: 'Journey', purpose: 'The work and learning process', expectedPosition: 0.5 },
      { name: 'Success', purpose: 'Show the positive outcome', expectedPosition: 0.7 },
      { name: 'Lessons Learned', purpose: 'Share actionable advice', expectedPosition: 0.85 },
    ],
  },
  {
    name: 'open-loop',
    arc: 'hook → loops → close',
    phases: [
      { name: 'Strong Hook', purpose: 'Open a mental loop', expectedPosition: 0 },
      { name: 'Loop 1', purpose: 'Introduce sub-topic and leave hanging', expectedPosition: 0.15 },
      { name: 'Loop 2', purpose: 'Another sub-topic, reinforcing curiosity', expectedPosition: 0.35 },
      { name: 'Loop 3', purpose: 'Third thread building to conclusion', expectedPosition: 0.55 },
      { name: 'Close All Loops', purpose: 'Satisfy all opened loops in sequence', expectedPosition: 0.8 },
    ],
  },
];

const EMOTIONAL_TRIGGERS: Record<string, RegExp[]> = {
  excitement: [/\b(amazing|incredible|unbelievable|mind.blowing|explosive|huge|massive|epic|legendary)\b/i],
  curiosity: [/\b(secret|hidden|revealed|mystery|truth|why|how|what if|discover|uncover)\b/i],
  urgency: [/\b(now|today|limited|before|deadline|hurry|immediately|critical|crucial)\b/i],
  inspiration: [/\b(inspiring|motivation|dream|achieve|overcome|transform|breakthrough|impossible)\b/i],
  fear: [/\b(danger|risk|threat|warning|avoid|mistake|costly|devastating|worst)\b/i],
  surprise: [/\b(shocking|unexpected|crazy|insane|wild|nobody expected|took me by surprise)\b/i],
  trust: [/\b(honest|truthful|real|authentic|genuine|actually|research|study|evidence|proven)\b/i],
  belonging: [/\b(community|together|we|us|our|shared|everyone|anyone who)\b/i],
  greed: [/\b(free|save|money|cash|profit|discount|bonus|extra|more|earn)\b/i],
  nostalgia: [/\b(remember|back when|classic|originally|before|when I was|grew up)\b/i],
};

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 5);
}

export class StorytellingAnalyzer {
  detectStructure(transcript: string): StorytellingStructure | null {
    const sentences = splitIntoSentences(transcript);
    if (sentences.length < 5) return null;

    const totalSentences = sentences.length;
    let bestStructure: StorytellingStructure | null = null;
    let bestConfidence = 0;

    for (const template of STRUCTURE_TEMPLATES) {
      let matchedPhases = 0;
      const phases: StoryPhase[] = [];

      for (const phase of template.phases) {
        const startIdx = Math.floor(phase.expectedPosition * totalSentences);
        const windowSize = Math.max(3, Math.floor(totalSentences * 0.1));
        const windowStart = Math.max(0, startIdx - Math.floor(windowSize / 2));
        const windowEnd = Math.min(totalSentences, startIdx + Math.floor(windowSize / 2) + 1);
        const windowSentences = sentences.slice(windowStart, windowEnd).join(' ');

        const keywordCount = this.countKeywords(windowSentences, phase.purpose);

        if (keywordCount > 0) {
          matchedPhases++;
          phases.push({
            name: phase.name,
            startPosition: windowStart,
            endPosition: Math.min(totalSentences - 1, windowEnd),
            purpose: phase.purpose,
          });
        }
      }

      const confidence = matchedPhases / template.phases.length;
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestStructure = {
          name: template.name,
          arc: template.arc,
          confidence: Math.round(confidence * 100),
          phases: phases.length > 0
            ? phases
            : [{ name: 'Unknown', startPosition: 0, endPosition: totalSentences - 1, purpose: 'Could not detect phases' }],
        };
      }
    }

    return bestStructure;
  }

  private countKeywords(text: string, purpose: string): number {
    const keywords: Record<string, string[]> = {
      'problem': ['problem', 'issue', 'struggle', 'difficult', 'hard', 'challenge', 'pain', 'frustrat', 'annoy', 'broken'],
      'solution': ['solution', 'answer', 'fix', 'solve', 'resolve', 'how to', 'method', 'approach', 'technique'],
      'hook': ['imagine', 'what if', 'here\'s', 'this is', 'the', 'you', 'your', 'why', 'how', 'secret'],
      'reveal': ['reveal', 'discover', 'found', 'realized', 'truth', 'actually', 'turns out', 'uncovered'],
      'story': ['when', 'then', 'after', 'before', 'remember', 'back', 'experience', 'happened', 'went', 'came'],
      'tension': ['but', 'however', 'despite', 'although', 'suddenly', 'unexpected', 'instead', 'yet'],
      'climax': ['finally', 'the moment', 'then it happened', 'everything changed', 'the turning point', 'last'],
      'result': ['result', 'outcome', 'after', 'now', 'today', 'since', 'because', 'led to', 'created'],
      'learning': ['learn', 'lesson', 'taught', 'discover', 'understand', 'realize', 'knew', 'found out'],
      'cta': ['subscribe', 'like', 'comment', 'follow', 'share', 'check', 'button', 'link', 'next video'],
    };

    const purposeLower = purpose.toLowerCase();
    const textLower = text.toLowerCase();
    let count = 0;

    for (const [category, words] of Object.entries(keywords)) {
      if (purposeLower.includes(category) || purposeLower.includes(category.replace(/-/g, ' '))) {
        for (const word of words) {
          if (textLower.includes(word)) count++;
        }
      }
    }

    if (count === 0 && text.length > 50) count = 1; // meaningful content exists
    return count;
  }

  scoreNarrativeArc(structure: StorytellingStructure | null, sentences: number): number {
    if (!structure) return sentences > 3 ? 30 : 50;

    let score = 0;

    if (structure.confidence > 70) score += 40;
    else if (structure.confidence > 40) score += 25;
    else score += 10;

    const phaseRatio = structure.phases.length / 5;
    score += phaseRatio * 30;

    if (sentences >= 10) score += 15;
    else if (sentences >= 5) score += 8;

    const knownStructures = ['problem-solution', 'hook-story-payoff', 'list-format', 'curiosity-gap', 'rags-to-riches', 'open-loop'];
    if (knownStructures.includes(structure.name)) score += 15;

    return Math.min(100, Math.round(score));
  }

  async analyzeEmotionalArc(transcript: string): Promise<EmotionalArc> {
    const sentences = splitIntoSentences(transcript);
    const points: EmotionalPoint[] = [];
    const emotionScores: Record<string, number> = {};

    for (const [index, sentence] of sentences.entries()) {
      let topEmotion = 'neutral';
      let topIntensity = 0;

      for (const [emotion, patterns] of Object.entries(EMOTIONAL_TRIGGERS)) {
        for (const pattern of patterns) {
          const matches = sentence.match(pattern);
          if (matches) {
            emotionScores[emotion] = (emotionScores[emotion] || 0) + matches.length;
            const intensity = Math.min(100, matches.length * 25 + 10);
            if (intensity > topIntensity) {
              topIntensity = intensity;
              topEmotion = emotion;
            }
          }
        }
      }

      points.push({
        position: index,
        emotion: topEmotion,
        intensity: Math.max(1, topIntensity),
      });
    }

    if (points.length === 0) {
      return {
        dominant: 'neutral',
        trajectory: [{ position: 0, emotion: 'neutral', intensity: 1 }],
        variety: 0,
        primaryEmotion: 'neutral',
        secondaryEmotion: 'neutral',
      };
    }

    const sorted = Object.entries(emotionScores).sort((a, b) => b[1] - a[1]);
    const primaryEmotion = sorted[0]?.[0] || 'neutral';
    const secondaryEmotion = sorted[1]?.[0] || 'neutral';
    const variety = Math.min(1, Object.keys(emotionScores).length / 10);

    return {
      dominant: primaryEmotion,
      trajectory: points,
      variety: Math.round(variety * 100),
      primaryEmotion,
      secondaryEmotion,
    };
  }
}
