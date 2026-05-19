import axios from 'axios';
import { logger } from '../utils/logger';
import type { TranscriptData } from '../types';

const TRANSCRIPT_API_BASE = 'https://transcriptapi.com/api/v1';

export async function fetchTranscript(videoId: string): Promise<TranscriptData | null> {
  try {
    const apiKey = process.env.TRANSCRIPT_API_KEY;
    if (!apiKey) {
      logger.warn('No TRANSCRIPT_API_KEY configured');
      return null;
    }

    const response = await axios.get(`${TRANSCRIPT_API_BASE}/transcript/${videoId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'YouTubeAI/1.0',
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const data = response.data;
    return {
      videoId,
      title: data.title || '',
      transcript: data.transcript || '',
      language: data.language || 'en',
      hooks: extractHooks(data.transcript || ''),
      pacing: calculatePacing(data.transcript || ''),
      retentionPatterns: analyzeRetentionPatterns(data.transcript || ''),
      callToAction: extractCTA(data.transcript || ''),
      emotionalTone: analyzeEmotionalTone(data.transcript || ''),
    };
  } catch (error: any) {
    logger.error(`Failed to fetch transcript for video ${videoId}`, { error: error.message });
    return null;
  }
}

export async function fetchMultipleTranscripts(videoIds: string[]): Promise<TranscriptData[]> {
  const results = await Promise.allSettled(
    videoIds.map((id) => fetchTranscript(id))
  );
  return results
    .filter((r): r is PromiseFulfilledResult<TranscriptData> => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);
}

function extractHooks(transcript: string): string[] {
  if (!transcript) return [];
  const sentences = transcript.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  return sentences.slice(0, 3).map(s => s.length > 100 ? s.substring(0, 100) + '...' : s);
}

function calculatePacing(transcript: string): number {
  if (!transcript) return 0;
  const words = transcript.split(/\s+/).length;
  const sentences = transcript.split(/[.!?]+/).length;
  return sentences > 0 ? Math.round(words / sentences) : 0;
}

function analyzeRetentionPatterns(transcript: string): string[] {
  if (!transcript) return [];
  const patterns: string[] = [];
  const lower = transcript.toLowerCase();

  if (lower.includes('but here\'s the thing') || lower.includes('here\'s the kicker')) {
    patterns.push('pattern-interrupt');
  }
  if (lower.includes('you won\'t believe') || lower.includes('wait until')) {
    patterns.push('curiosity-gap');
  }
  if (lower.includes('subscribe') || lower.includes('follow')) {
    patterns.push('cta-early');
  }
  if (lower.includes('imagine') || lower.includes('picture this')) {
    patterns.push('visualization');
  }

  return patterns;
}

function extractCTA(transcript: string): string {
  if (!transcript) return '';
  const lines = transcript.split('\n');
  const ctaKeywords = ['subscribe', 'like', 'comment', 'follow', 'share', 'check out', 'hit that'];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (ctaKeywords.some(k => lower.includes(k))) {
      return line.trim();
    }
  }
  return '';
}

function analyzeEmotionalTone(transcript: string): string {
  if (!transcript) return 'neutral';
  const lower = transcript.toLowerCase();
  const emotions = {
    excited: ['amazing', 'incredible', 'unbelievable', 'mind-blowing', 'crazy', 'wow'],
    curious: ['secret', 'hidden', 'revealed', 'truth', 'why', 'how', 'what if'],
    urgent: ['now', 'today', 'limited', 'before', 'deadline', 'hurry'],
    emotional: ['heartbreaking', 'inspiring', 'touching', 'emotional', 'tears'],
  };

  const scores: Record<string, number> = {};
  for (const [emotion, words] of Object.entries(emotions)) {
    scores[emotion] = words.filter(w => lower.includes(w)).length;
  }

  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';
}
