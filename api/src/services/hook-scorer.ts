import type { DetectedHook, HookType, HookQualityScore } from '../types';

const HOOK_TYPE_STRENGTHS: Record<HookType, { dimensions: Partial<HookQualityScore['dimensions']>; label: string }> = {
  'curiosity-gap': {
    dimensions: { curiosity: 95, emotionalAppeal: 60, urgency: 40 },
    label: 'Curiosity Gap',
  },
  'pattern-interrupt': {
    dimensions: { curiosity: 70, uniqueness: 80, urgency: 30 },
    label: 'Pattern Interrupt',
  },
  'provocative-question': {
    dimensions: { curiosity: 80, relevance: 70, emotionalAppeal: 60 },
    label: 'Provocative Question',
  },
  'bold-statement': {
    dimensions: { curiosity: 75, uniqueness: 85, emotionalAppeal: 65 },
    label: 'Bold Statement',
  },
  'shocking-statistic': {
    dimensions: { specificity: 90, curiosity: 80, relevance: 70 },
    label: 'Shocking Statistic',
  },
  'story-bait': {
    dimensions: { emotionalAppeal: 85, relevance: 70, clarity: 60 },
    label: 'Story Bait',
  },
  'benefit-forward': {
    dimensions: { relevance: 90, clarity: 80, urgency: 50 },
    label: 'Benefit Forward',
  },
  'urgency': {
    dimensions: { urgency: 95, relevance: 70, emotionalAppeal: 60 },
    label: 'Urgency',
  },
  'controversy': {
    dimensions: { uniqueness: 90, emotionalAppeal: 80, curiosity: 70 },
    label: 'Controversy',
  },
  'relatable-problem': {
    dimensions: { relevance: 90, emotionalAppeal: 75, clarity: 70 },
    label: 'Relatable Problem',
  },
  'unknown': {
    dimensions: { clarity: 30, relevance: 30, curiosity: 20, emotionalAppeal: 20, specificity: 20, uniqueness: 20, urgency: 20 },
    label: 'Unknown',
  },
};

function scoreClarity(text: string): number {
  const words = text.split(/\s+/).length;
  if (words < 5) return 40;
  if (words < 10) return 70;
  if (words < 20) return 85;
  if (words < 30) return 70;
  return 50;
}

function scoreRelevance(text: string): number {
  const hasActionable = /\b(how|why|what|way|tip|method|step|strategy|technique|guide|tutorial|lesson)\b/i.test(text);
  const hasSpecific = /\b(\d+|your|you|yourself)\b/i.test(text);
  let score = 50;
  if (hasActionable) score += 25;
  if (hasSpecific) score += 15;
  return Math.min(100, score + (text.length > 30 ? 10 : 0));
}

function scoreSpecificity(text: string): number {
  const hasNumbers = /\d+/.test(text);
  const hasNames = /[A-Z][a-z]+/.test(text);
  const hasDetails = text.split(/\s+/).length > 8;
  let score = 30;
  if (hasNumbers) score += 30;
  if (hasNames) score += 20;
  if (hasDetails) score += 20;
  return Math.min(100, score);
}

function scoreUniqueness(text: string): number {
  const cliches = [
    'hey guys', "what's up", 'welcome back', 'in this video', 'today we',
    'in today\'s video', 'make sure to', 'don\'t forget to', 'smash that like',
    'hit the bell', 'leave a comment', 'thanks for watching',
  ];
  const lower = text.toLowerCase();
  const clicheCount = cliches.filter(c => lower.includes(c)).length;
  return Math.max(20, 100 - clicheCount * 30);
}

function scoreUrgency(text: string): number {
  const urgencyWords = /\b(now|today|limited|before|immediately|urgent|deadline|hurry|last chance|don\'t miss)\b/i;
  const matches = text.match(urgencyWords);
  return matches ? Math.min(100, matches.length * 25 + 20) : 20;
}

export class HookQualityScorer {
  scoreHooks(hooks: DetectedHook[]): HookQualityScore {
    if (hooks.length === 0) {
      return {
        overall: 0,
        dimensions: { curiosity: 0, clarity: 0, relevance: 0, emotionalAppeal: 0, specificity: 0, uniqueness: 0, urgency: 0 },
        strengths: [],
        weaknesses: [],
      };
    }

    const firstHook = hooks[0];
    const typeProfile = HOOK_TYPE_STRENGTHS[firstHook.type] || HOOK_TYPE_STRENGTHS['unknown'];

    const clarity = scoreClarity(firstHook.text);
    const relevance = scoreRelevance(firstHook.text);
    const specificity = scoreSpecificity(firstHook.text);
    const uniqueness = scoreUniqueness(firstHook.text);
    const urgency = scoreUrgency(firstHook.text);

    const curiosity = Math.round(
      ((typeProfile.dimensions.curiosity || 50) + firstHook.score * 0.7) / 2
    );
    const emotionalAppeal = Math.round(
      ((typeProfile.dimensions.emotionalAppeal || 50) + firstHook.score * 0.5) / 2
    );

    const dimensions = { curiosity, clarity, relevance, emotionalAppeal, specificity, uniqueness, urgency };
    const overall = Math.round(Object.values(dimensions).reduce((a, b) => a + b, 0) / 7);

    const strengths: string[] = [];
    const weaknesses: string[] = [];

    if (curiosity >= 70) strengths.push('Strong curiosity gap drives initial click');
    if (clarity >= 70) strengths.push('Clear and easy to understand immediately');
    if (relevance >= 70) strengths.push('Highly relevant to target audience');
    if (emotionalAppeal >= 70) strengths.push('Strong emotional appeal hooks viewer investment');
    if (specificity >= 70) strengths.push('Specific details create credibility');
    if (uniqueness >= 70) strengths.push('Fresh approach stands out from competition');
    if (urgency >= 70) strengths.push('Creates time-sensitive motivation to watch now');

    if (curiosity < 40) weaknesses.push('Low curiosity - viewer has no reason to continue');
    if (clarity < 40) weaknesses.push('Unclear message - viewers won\'t understand the value');
    if (relevance < 40) weaknesses.push('Weak relevance to viewer\'s interests or needs');
    if (emotionalAppeal < 40) weaknesses.push('Low emotional connection - lacks feeling');
    if (specificity < 40) weaknesses.push('Too vague - needs specific details or numbers');
    if (uniqueness < 40) weaknesses.push('Generic opener - blends in with competitors');
    if (urgency < 40) weaknesses.push('No urgency or time sensitivity');

    if (strengths.length === 0) strengths.push('One or more hook types detected');
    if (weaknesses.length === 0) weaknesses.push('No significant weaknesses detected');

    return { overall, dimensions, strengths, weaknesses };
  }
}
