import type { SEOResult } from '../types';

const SYNONYM_MAP: Record<string, string[]> = {
  amazing: ['incredible', 'unbelievable', 'stunning', 'remarkable'],
  best: ['top', 'leading', 'finest', 'greatest'],
  big: ['massive', 'huge', 'enormous', 'substantial'],
  change: ['transform', 'revolutionize', 'shift', 'alter'],
  easy: ['simple', 'effortless', 'straightforward', 'painless'],
  fast: ['rapid', 'quick', 'lightning', 'speedy'],
  get: ['achieve', 'obtain', 'unlock', 'master'],
  good: ['excellent', 'outstanding', 'superb', 'exceptional'],
  great: ['fantastic', 'terrific', 'magnificent', 'splendid'],
  help: ['boost', 'supercharge', 'accelerate', 'enhance'],
  important: ['crucial', 'vital', 'essential', 'critical'],
  learn: ['discover', 'master', 'uncover', 'explore'],
  make: ['create', 'build', 'craft', 'develop'],
  new: ['fresh', 'cutting-edge', 'next-level', 'breakthrough'],
  secret: ['hidden', 'little-known', 'undisclosed', 'classified'],
  simple: ['basic', 'fundamental', 'core', 'essential'],
  special: ['unique', 'exclusive', 'one-of-a-kind', 'rare'],
  tips: ['strategies', 'techniques', 'methods', 'tactics'],
  top: ['leading', 'premier', 'ultimate', 'elite'],
  try: ['experience', 'test', 'sample', 'explore'],
  use: ['leverage', 'utilize', 'implement', 'apply'],
  very: ['extremely', 'incredibly', 'remarkably', 'exceptionally'],
  want: ['desire', 'seek', 'pursue', 'crave'],
  way: ['method', 'approach', 'technique', 'system'],
  work: ['operate', 'function', 'perform', 'run'],
};

const PREFIXES = ['The Ultimate', 'The Complete', 'The Essential', ''];
const TRANSITION_PHRASES = [
  'Here is the thing:',
  'Now, here is where it gets interesting:',
  'Let me break this down:',
  'So, what does this mean?',
  'Here is what you need to know:',
  'Think about it this way:',
  'This is crucial:',
  'The truth is,',
  'At the end of the day,',
  'When you really think about it,',
];

const AI_PATTERNS = [
  { pattern: /furthermore|moreover|in addition|consequently|nevertheless|nonetheless|thus\b/gi, label: 'formal transition' },
  { pattern: /it is important to note|it should be noted|it is worth mentioning/gi, label: 'hedging phrase' },
  { pattern: /in (today'?s|this) (video|article|episode|guide)/gi, label: 'generic intro' },
  { pattern: /let'?s dive (into|in|right in)/gi, label: 'overused transition' },
  { pattern: /without further ado/gi, label: 'cliche phrase' },
  { pattern: /this (means|implies|suggests) that/gi, label: 'robotic connector' },
  { pattern: /as we (can |)?see|as you (can |)?see/gi, label: 'redundant reference' },
  { pattern: /in (other|simpler) words/gi, label: 'redundant rephrase' },
  { pattern: /the (concept|idea|notion) of/gi, label: 'academic phrasing' },
  { pattern: /due to the fact that|owing to the fact that/gi, label: 'wordy construction' },
];

const CLICKBAIT_PATTERNS = [
  /YOU WON'T BELIEVE/i,
  /YOU'LL NEVER/i,
  /SHOCKING/i,
  /MIND BLOWING/i,
  /GONE WRONG/i,
  /GONE SEXUAL/i,
  /ALMOST DIED/i,
  /INCREDIBLE/i,
  /(BEST|TOP|GREATEST).*(EVER|OF ALL TIME)/i,
  /NUMBER \d+ WILL/i,
  /DO NOT/i,
  /WHAT HAPPENED NEXT/i,
  /YOU NEED TO SEE/i,
  /THIS IS WHY/i,
];

const SPAMMY_TAG_PATTERNS = [
  /^viral$/i, /^trending$/i, /^must watch$/i, /^click here$/i,
  /^subscribe$/i, /^like$/i, /^share$/i, /^follow$/i,
  /^#\w+$/,
  /^\d{4}$/,
  /^funny videos?$/i,
  /^for you page$/i,
];

const WORDY_TRANSITIONS = [
  'furthermore', 'moreover', 'in addition', 'consequently',
  'nevertheless', 'nonetheless', 'thus', 'hence', 'thereby',
  'accordingly', 'subsequently',
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function splitSentences(text: string): string[] {
  const result: string[] = [];
  const parts = text.split(/(?<=[.!?])\s+/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) result.push(trimmed);
  }
  return result.length > 0 ? result : [text];
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function wordSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 2));
}

export function calculateTextSimilarity(a: string, b: string): number {
  const wordsA = wordSet(a);
  const wordsB = wordSet(b);
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.size / union.size;
}

export function detectAIPatterns(text: string): { score: number; patterns: string[] } {
  const found: string[] = [];
  for (const entry of AI_PATTERNS) {
    const matches = text.match(entry.pattern);
    if (matches) {
      found.push(`${entry.label} (${matches.length}x)`);
    }
  }
  const wordCount = countWords(text);
  const repetitionScore = Math.min(30, found.length * 6);
  const structureScore = Math.min(40, Math.max(0, 20 - Math.abs(15 - wordCount / 10)));
  const score = Math.min(100, repetitionScore + structureScore);
  return { score, patterns: found };
}

export function humanizeText(text: string): string {
  let result = text;

  for (const word of WORDY_TRANSITIONS) {
    const replacement = pickRandom(['but', 'so', 'and', 'anyway', 'actually', 'then', 'plus']);
    result = result.replace(new RegExp(`\\b${word}\\b`, 'gi'), replacement);
  }

  const sentences = splitSentences(result);
  for (let i = 1; i < sentences.length; i++) {
    if (Math.random() < 0.15) {
      const filler = pickRandom(['honestly,', 'here is the thing,', 'truth is,', 'believe it or not,', 'you know what,']);
      sentences[i] = `${filler} ${sentences[i].toLowerCase()}`;
    }
  }
  result = sentences.join(' ');

  if (result.endsWith('.')) {
    const exclaim = Math.random() < 0.08;
    if (exclaim) result = result.slice(0, -1) + '!';
  }

  if (Math.random() < 0.12 && result.length > 5) {
    const idx = Math.floor(Math.random() * (result.length - 3)) + 1;
    result = result.slice(0, idx) + '... ' + result.slice(idx);
  }

  return result;
}

export class ContentRandomizer {
  randomizeTitle(title: string): string {
    const words = title.split(/\s+/);
    const numChanges = Math.min(2, Math.max(1, Math.floor(words.length / 4)));

    for (let i = 0; i < numChanges; i++) {
      const idx = Math.floor(Math.random() * words.length);
      const clean = words[idx].replace(/[^a-zA-Z]/g, '').toLowerCase();
      const synonyms = SYNONYM_MAP[clean];
      if (synonyms) {
        const replacement = pickRandom(synonyms);
        const hasCaps = words[idx][0] === words[idx][0]?.toUpperCase();
        words[idx] = words[idx].replace(/[a-zA-Z]+/g, hasCaps ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement);
      }
    }

    if (Math.random() < 0.3) {
      const prefix = pickRandom(PREFIXES);
      if (prefix) {
        return `${prefix} ${words.join(' ')}`;
      }
    } else if (Math.random() < 0.2 && PREFIXES.includes(words[0] + ' ' + words[1])) {
      words.shift();
    }

    return words.join(' ');
  }

  randomizeDescription(description: string): string {
    const sentences = splitSentences(description);
    const modified = sentences.map(s => {
      if (Math.random() < 0.3) {
        const words = s.split(/\s+/);
        if (words.length > 4) {
          const rephraseStart = Math.random() < 0.5;
          if (rephraseStart) {
            const transitions = ['First,', 'So,', 'Also,', 'Additionally,', 'On top of that,'];
            return `${pickRandom(transitions)} ${words.slice(1).join(' ')}`;
          }
          const idx = Math.floor(Math.random() * words.length);
          const clean = words[idx].replace(/[^a-zA-Z]/g, '').toLowerCase();
          const synonyms = SYNONYM_MAP[clean];
          if (synonyms) {
            words[idx] = words[idx].replace(/[a-zA-Z]+/g, pickRandom(synonyms));
          }
          return words.join(' ');
        }
      }
      return s;
    });

    if (modified.length > 3) {
      const extraSentence = pickRandom([
        'Let me know your thoughts in the comments!',
        'Hope this helps you on your journey.',
        'This is just the beginning of what is possible.',
      ]);
      modified.splice(Math.floor(Math.random() * (modified.length - 1)) + 1, 0, extraSentence);
    }

    return modified.join(' ');
  }

  randomizeTags(tags: string[]): string[] {
    let result = shuffleArray(tags);

    const lowValue = result.filter(t => SPAMMY_TAG_PATTERNS.some(p => p.test(t)));
    const keep = result.filter(t => !SPAMMY_TAG_PATTERNS.some(p => p.test(t)));

    const removeCount = Math.min(lowValue.length, Math.max(1, Math.floor(lowValue.length / 2)));
    for (let i = 0; i < removeCount && lowValue.length > 0; i++) {
      lowValue.pop();
    }

    result = shuffleArray([...keep, ...lowValue]);

    const relatedTags = ['tutorial', 'howto', 'guide', 'tips', 'diy', 'explainer', 'overview'];
    const topicWords = keep.flatMap(t => t.split(/\s+/)).filter(w => w.length > 3);
    const addCount = Math.min(2, Math.max(1, topicWords.length > 0 ? 1 : 0));
    for (let i = 0; i < addCount; i++) {
      const candidate = pickRandom(relatedTags);
      if (!result.includes(candidate)) {
        result.push(candidate);
      }
    }

    return result;
  }

  addContentVariance(script: string): string {
    const sentences = splitSentences(script);
    const varied = sentences.map((s, i) => {
      if (i > 0 && Math.random() < 0.2) {
        const transition = pickRandom(TRANSITION_PHRASES);
        return `${transition} ${s.charAt(0).toLowerCase() + s.slice(1)}`;
      }

      if (i === 0 && s.length > 20 && Math.random() < 0.25) {
        const openings = [
          'Have you ever wondered:',
          'Let me ask you something:',
          'Here is what nobody tells you:',
          'So here is the deal:',
        ];
        const opening = pickRandom(openings);
        return `${opening} ${s.charAt(0).toLowerCase() + s.slice(1)}`;
      }

      const words = s.split(/\s+/);
      if (words.length > 6 && Math.random() < 0.15) {
        if (words[0].length > 3) {
          const connectors = ['So', 'But', 'And', 'Plus', 'Actually,'];
          words[0] = `${pickRandom(connectors)} ${words[0].toLowerCase()}`;
        }
      }

      return words.join(' ');
    });

    return varied.join(' ');
  }
}

export class YouTubePolicyGuard {
  checkSpamScore(title: string, description: string, tags: string[]): { score: number; warnings: string[]; passed: boolean } {
    const warnings: string[] = [];
    let score = 0;

    const titleWords = title.split(/\s+/);

    if (title === title.toUpperCase() && title.length > 10) {
      score += 20;
      warnings.push('Title is in ALL CAPS');
    }

    const emojiCount = (title.match(/[\u{1F000}-\u{1FFFF}]/gu) || []).length;
    if (emojiCount > 3) {
      score += 15;
      warnings.push('Excessive emoji usage in title');
    }

    for (const pattern of CLICKBAIT_PATTERNS) {
      if (pattern.test(title)) {
        score += 15;
        warnings.push(`Clickbait pattern detected: ${pattern.source.slice(0, 30)}`);
      }
    }

    const exclamationCount = (title.match(/!/g) || []).length;
    if (exclamationCount > 1) {
      score += 10;
      warnings.push('Multiple exclamation marks in title');
    }

    if (titleWords.length > 15) {
      score += 10;
      warnings.push('Title is too long (>15 words)');
    }

    const descWords = description.split(/\s+/).filter(Boolean);
    const descWordCount = descWords.length;

    const uniqueWords = new Set(descWords.map(w => w.toLowerCase()));
    const keywordDensity = 1 - (uniqueWords.size / descWordCount);
    if (keywordDensity > 0.6 && descWordCount > 20) {
      score += 20;
      warnings.push('High keyword stuffing detected in description');
    }

    const repeatedPhrases: string[] = [];
    const trigrams = new Map<string, number>();
    for (let i = 0; i < descWords.length - 2; i++) {
      const phrase = descWords.slice(i, i + 3).map(w => w.toLowerCase()).join(' ');
      trigrams.set(phrase, (trigrams.get(phrase) || 0) + 1);
    }
    for (const [phrase, count] of trigrams) {
      if (count > 2 && phrase.split(/\s+/).every(w => w.length > 2)) {
        repeatedPhrases.push(phrase);
      }
    }
    if (repeatedPhrases.length > 2) {
      score += 15;
      warnings.push('Repetitive phrase patterns detected');
    }

    const irrelevantTags = tags.filter(t => {
      const inTitle = title.toLowerCase().includes(t.toLowerCase());
      const inDesc = description.toLowerCase().includes(t.toLowerCase());
      return !inTitle && !inDesc;
    });
    if (irrelevantTags.length > tags.length * 0.4) {
      score += 10;
      warnings.push('High proportion of irrelevant tags');
    }

    if (tags.length > 15) {
      score += 5;
      warnings.push('Excessive number of tags');
    }

    const finalScore = Math.min(100, Math.max(0, score));
    return { score: finalScore, warnings, passed: finalScore < 40 };
  }

  checkDuplicateContentRisk(title: string, existingTitles: string[]): { risk: 'low' | 'medium' | 'high'; similarity: number; recommendation: string } {
    if (existingTitles.length === 0) {
      return { risk: 'low', similarity: 0, recommendation: 'No existing content to compare against' };
    }

    let maxSimilarity = 0;
    let mostSimilarTitle = '';

    for (const existing of existingTitles) {
      const sim = calculateTextSimilarity(title, existing);
      if (sim > maxSimilarity) {
        maxSimilarity = sim;
        mostSimilarTitle = existing;
      }
    }

    let risk: 'low' | 'medium' | 'high';
    let recommendation: string;

    if (maxSimilarity > 0.7) {
      risk = 'high';
      recommendation = `Too similar to existing video: "${mostSimilarTitle.substring(0, 60)}". Consider changing the angle, keywords, or phrasing significantly.`;
    } else if (maxSimilarity > 0.4) {
      risk = 'medium';
      recommendation = `Some overlap with "${mostSimilarTitle.substring(0, 60)}". Try using different keywords or a fresh angle.`;
    } else {
      risk = 'low';
      recommendation = `Sufficiently distinct from existing content (max similarity: ${Math.round(maxSimilarity * 100)}%).`;
    }

    return { risk, similarity: Math.round(maxSimilarity * 100) / 100, recommendation };
  }

  suggestPolicyCompliantTitle(title: string): string {
    let result = title;

    if (result === result.toUpperCase()) {
      result = result.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    }

    const emojiCount = (result.match(/[\u{1F000}-\u{1FFFF}]/gu) || []).length;
    if (emojiCount > 2) {
      const chars = [...result];
      const filtered = chars.filter(c => !c.match(/[\u{1F000}-\u{1FFFF}]/u));
      result = filtered.join('').trim();
    }

    for (const pattern of CLICKBAIT_PATTERNS) {
      result = result.replace(pattern, match => {
        const lower = match.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      });
    }

    const exclamationCount = (result.match(/!/g) || []).length;
    if (exclamationCount > 1) {
      result = result.replace(/!/g, '');
      result = result.trim() + '.';
    }

    if (result.split(/\s+/).length > 12) {
      const words = result.split(/\s+/);
      result = words.slice(0, 12).join(' ');
    }

    return result;
  }

  generateHumanLikeTags(topic: string, tags: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();

    const cleanTag = (t: string) => t.replace(/[#]/g, '').trim().toLowerCase();

    const topicWords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    const nicheTerms = topicWords.slice(0, 3).map(w => cleanTag(w));
    for (const term of nicheTerms) {
      if (term && !seen.has(term)) {
        result.push(term);
        seen.add(term);
      }
    }

    const filteredTags = tags
      .map(cleanTag)
      .filter(t => {
        if (seen.has(t)) return false;
        if (SPAMMY_TAG_PATTERNS.some(p => p.test(t))) return false;
        return t.length > 1 && t.length < 40;
      });

    const maxTags = Math.min(10, Math.max(3, filteredTags.length));
    const shuffled = shuffleArray(filteredTags);

    for (const tag of shuffled) {
      if (result.length >= maxTags) break;
      if (!seen.has(tag)) {
        result.push(tag);
        seen.add(tag);
      }
    }

    const naturalPrefixes = ['how to', 'what is', 'best', 'easy', 'ultimate', 'simple'];
    const formatted = result.map(t => {
      if (t.includes(' ') && Math.random() < 0.15) {
        const prefix = pickRandom(naturalPrefixes);
        if (!t.startsWith(prefix)) {
          return `${prefix} ${t}`;
        }
      }
      return t;
    });

    return formatted;
  }
}

export class ContentDiversityGuard {
  ensureDiversity(content: string, previousContents: string[]): { score: number; issues: string[] } {
    const issues: string[] = [];
    const sentences = splitSentences(content);

    if (sentences.length < 3) {
      return { score: 100, issues: ['Content too short to analyze diversity'] };
    }

    const openings = sentences.map(s => {
      const words = s.split(/\s+/);
      return words[0]?.replace(/[^a-zA-Z]/g, '') || '';
    }).filter(Boolean);

    const openingFreq = new Map<string, number>();
    for (const o of openings) {
      openingFreq.set(o, (openingFreq.get(o) || 0) + 1);
    }
    const repeatedOpenings = [...openingFreq.entries()].filter(([, c]) => c > 2);
    if (repeatedOpenings.length > 0) {
      issues.push('Sentence openings are repetitive');
    }

    const sentenceLengths = sentences.map(s => s.split(/\s+/).length);
    const avgLen = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
    const variance = sentenceLengths.reduce((sum, len) => sum + Math.pow(len - avgLen, 2), 0) / sentenceLengths.length;
    if (variance < 5) {
      issues.push('Low sentence length variety');
    }

    const allWords = content.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const uniqueWords = new Set(allWords);
    const vocabularyRatio = uniqueWords.size / allWords.length;
    if (vocabularyRatio < 0.35 && allWords.length > 20) {
      issues.push('Low vocabulary diversity');
    }

    const ctaPatterns = [
      /subscribe/i, /like/i, /comment/i, /share/i, /follow/i,
      /hit (that|the) (bell|button)/i, /turn on notifications/i,
      /check (out|the) (link|description|video)/i,
    ];
    const ctaCount = ctaPatterns.filter(p => p.test(content)).length;
    if (ctaCount < 1) {
      issues.push('No call-to-action detected');
    } else if (ctaCount > 3) {
      issues.push('Excessive call-to-action repetition');
    }

    let previousPatternScore = 0;
    if (previousContents.length > 0) {
      for (const prev of previousContents) {
        const sim = calculateTextSimilarity(content, prev);
        if (sim > 0.5) {
          issues.push('High structural similarity with previous content');
          previousPatternScore += 20;
        }
      }
    }

    let score = 100;
    score -= repeatedOpenings.length * 15;
    score -= variance < 5 ? 10 : 0;
    score -= vocabularyRatio < 0.35 ? 15 : 0;
    score -= ctaCount < 1 ? 10 : (ctaCount > 3 ? 10 : 0);
    score -= previousPatternScore;
    score = Math.max(0, Math.min(100, score));

    return { score, issues };
  }

  suggestDiverseVersion(content: string): string {
    const sentences = splitSentences(content);
    const diverse = sentences.map((s, i) => {
      if (i % 3 === 0 && i > 0 && sentences[i - 1].length > 10) {
        const shortVariants = [
          'But that is not all.',
          'Here is the kicker.',
          'Wait, there is more.',
          'Let that sink in.',
        ];
        return pickRandom(shortVariants);
      }

      const words = s.split(/\s+/);
      if (words.length > 10 && Math.random() < 0.25) {
        const mid = Math.floor(words.length / 2);
        const fragment = words.slice(0, mid).join(' ');
        return `${fragment}... ${words.slice(mid).join(' ')}`;
      }

      if (Math.random() < 0.15) {
        const questions = ['Right?', 'See what I mean?', 'Makes sense, does not it?', 'Get it?'];
        return `${s} ${pickRandom(questions)}`;
      }

      return s;
    });

    return diverse.join(' ');
  }
}
