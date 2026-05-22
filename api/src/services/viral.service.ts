// Viral scoring engine — predicts video performance before upload
import axios from 'axios';
import { prisma } from '../config/db';

export interface ViralScore {
  topic: string;
  scriptQuality: number; // 0-100
  keywordOptimization: number; // 0-100
  ctr: number; // 0-100 predicted Click-Through Rate
  watchTime: number; // 0-100 predicted watch time potential
  overall: number; // 0-100 final score
  recommendation: 'go' | 'revise' | 'hold';
}

// Scoring heuristics based on successful YouTube patterns
const SCORING_RULES = {
  hookLength: { min: 3, max: 8, optimal: 5 }, // seconds
  titleLength: { min: 30, max: 60, optimal: 45 },
  keywords: { min: 3, max: 8, optimal: 5 },
  emotionalScore: 0.6, // 60% of content should be emotionally engaging
};

export async function scoreViralPotential(input: {
  script: string;
  title: string;
  thumbnail?: string;
  topic?: string;
}): Promise<ViralScore> {
  try {
    // Rule 1: Script quality (hook, pacing, CTA)
    const scriptQuality = analyzeScriptQuality(input.script);

    // Rule 2: SEO optimization (title, keywords)
    const keywordOptimization = analyzeKeywordOptimization(input.title, input.script);

    // Rule 3: CTR prediction (thumbnail + title synergy)
    const ctr = predictCTR(input.title, input.thumbnail || 'generic');

    // Rule 4: Watch time potential (script retention patterns)
    const watchTime = predictWatchTime(input.script);

    // Weighted overall score
    const overall = Math.round(
      scriptQuality * 0.3 +
      keywordOptimization * 0.25 +
      ctr * 0.2 +
      watchTime * 0.25
    );

    const recommendation = overall >= 75 ? 'go' : overall >= 50 ? 'revise' : 'hold';

    return {
      topic: input.topic || 'general',
      scriptQuality,
      keywordOptimization,
      ctr,
      watchTime,
      overall,
      recommendation,
    };
  } catch (err: any) {
    console.error('[ViralScore] Error:', err.message);
    // Fallback to neutral score
    return {
      topic: input.topic || 'general',
      scriptQuality: 50,
      keywordOptimization: 50,
      ctr: 50,
      watchTime: 50,
      overall: 50,
      recommendation: 'revise',
    };
  }
}

function analyzeScriptQuality(script: string): number {
  let score = 50; // baseline

  // Hook presence (first 30 words should grab attention)
  const firstSentence = script.split('.')[0];
  if (firstSentence.length < 150 && firstSentence.includes('?')) score += 15;

  // Story structure (has beginning, middle, end)
  const sentences = script.split(/[.!?]+/).filter(s => s.trim());
  if (sentences.length >= 5) score += 10;

  // Emotional engagement (exclamation marks, questions, power words)
  const emotionalMarkers = (script.match(/[!?]/g) || []).length;
  if (emotionalMarkers >= 3) score += 15;

  // Call-to-action (subscribe, like, comment)
  const ctaPhrases = ['subscribe', 'like', 'comment', 'hit the notification'];
  const ctas = ctaPhrases.filter(cta => script.toLowerCase().includes(cta)).length;
  if (ctas >= 2) score += 10;

  return Math.min(score, 100);
}

function analyzeKeywordOptimization(title: string, script: string): number {
  let score = 50;

  // Title length (30-60 chars optimal)
  if (title.length >= 30 && title.length <= 60) score += 15;

  // Keywords in title (should have 2-4 power keywords)
  const powerWords = ['AI', 'Free', 'Easy', 'Beginners', 'Ultimate', 'Guide', 'Secret', 'Hidden'];
  const titleKeywords = powerWords.filter(w => title.includes(w)).length;
  if (titleKeywords >= 2) score += 15;

  // Keyword density in script (3-5 mentions of primary keyword)
  const primaryKeyword = title.split(' ')[0];
  const keywordCount = (script.match(new RegExp(primaryKeyword, 'gi')) || []).length;
  if (keywordCount >= 2 && keywordCount <= 6) score += 15;

  // Numbers in title (lists tend to perform better)
  if (/\d/.test(title)) score += 5;

  return Math.min(score, 100);
}

function predictCTR(title: string, thumbnailStyle: string): number {
  let score = 50;

  // Title curiosity gap (not spoiling the entire story)
  if (title.length > 35 && title.includes('?')) score += 15;

  // Emotional triggers
  const triggers = ['shocking', 'never', 'finally', 'exposed', 'secret', 'MUST WATCH'];
  if (triggers.some(t => title.toLowerCase().includes(t))) score += 15;

  // Number of words (8-12 words optimal)
  const wordCount = title.split(' ').length;
  if (wordCount >= 8 && wordCount <= 12) score += 10;

  return Math.min(score, 100);
}

function predictWatchTime(script: string): number {
  let score = 50;

  // Story pacing (alternating short and long sentences)
  const sentences = script.split(/[.!?]+/).filter(s => s.trim());
  const avgLength = sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;
  if (avgLength >= 50 && avgLength <= 200) score += 15;

  // Retention hooks (asking questions throughout)
  const questions = (script.match(/\?/g) || []).length;
  if (questions >= Math.ceil(sentences.length / 5)) score += 15;

  // Variety (mix of short and long content)
  const shortSentences = sentences.filter(s => s.trim().length < 50).length;
  const longSentences = sentences.filter(s => s.trim().length > 150).length;
  if (shortSentences > 0 && longSentences > 0) score += 10;

  return Math.min(score, 100);
}

export async function logViralPrediction(
  videoId: string,
  prediction: ViralScore,
  actualMetrics?: { ctr?: number; watchTime?: number }
) {
  // Store prediction for learning loop
  try {
    // Placeholder: would store in viralMetrics table for ML training
    console.log(`[ViralScore] Logged prediction for ${videoId}:`, prediction);
    if (actualMetrics) {
      console.log(`[ViralScore] Actual metrics:`, actualMetrics);
    }
  } catch (err: any) {
    console.error('[ViralScore] Logging error:', err.message);
  }
}

export default { scoreViralPotential, logViralPrediction };
