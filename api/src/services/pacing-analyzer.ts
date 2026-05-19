import { generateWithAI } from './ai.service';
import { aiLogger } from '../utils/logger';
import { extractJson } from '../utils/parse-ai-response';
import type { PacingPattern, PacingSegment, PacingHotspot } from '../types';

const TARGET_WORDS_PER_SECOND = 2.5;
const IDEAL_SENTENCE_LENGTH = 15;

export class PacingAnalyzer {
  analyze(transcript: string): PacingPattern {
    const words = transcript.split(/\s+/).filter(Boolean);
    const sentences = transcript
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (words.length === 0 || sentences.length === 0) {
      return {
        overall: 'moderate',
        wordsPerSecond: TARGET_WORDS_PER_SECOND,
        sentenceLengthAvg: IDEAL_SENTENCE_LENGTH,
        sentenceLengthVariation: 0,
        segments: [],
        hotspots: [],
      };
    }

    const wordsPerSecond = words.length / (sentences.length * 0.35);
    const sentenceLengths = sentences.map(s => s.split(/\s+/).length);
    const sentenceLengthAvg = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
    const variance = this.calculateVariance(sentenceLengths);

    const overall = this.classifyPace(wordsPerSecond, sentenceLengthAvg, variance);
    const segments = this.detectSegments(sentences, sentenceLengths);
    const hotspots = this.detectHotspots(sentences, sentenceLengths);

    return {
      overall,
      wordsPerSecond: Math.round(wordsPerSecond * 100) / 100,
      sentenceLengthAvg: Math.round(sentenceLengthAvg * 10) / 10,
      sentenceLengthVariation: Math.round(variance * 10) / 10,
      segments,
      hotspots,
    };
  }

  scoreTranscription(wordsPerSecond: number, sentenceLengthAvg: number, variation: number): number {
    let score = 100;

    const paceDiff = Math.abs(wordsPerSecond - TARGET_WORDS_PER_SECOND);
    if (paceDiff > 1.5) score -= 30;
    else if (paceDiff > 1) score -= 20;
    else if (paceDiff > 0.5) score -= 10;

    const lengthDiff = Math.abs(sentenceLengthAvg - IDEAL_SENTENCE_LENGTH);
    if (lengthDiff > 10) score -= 25;
    else if (lengthDiff > 5) score -= 15;
    else if (lengthDiff > 3) score -= 8;

    if (variation < 3) score += 5;
    else if (variation < 6) score += 10;
    else if (variation < 10) score += 5;
    else score -= 5;

    return Math.max(0, Math.min(100, score));
  }

  async enhanceWithAI(transcript: string, pattern: PacingPattern): Promise<PacingPattern> {
    try {
      const sample = transcript.substring(0, 1000);
      const prompt = `Analyze the pacing of this YouTube transcript and provide enhancement recommendations.

Transcript sample:
"""${sample}"""

Current pacing analysis: ${JSON.stringify(pattern)}

Return JSON: {
  "segments": [
    {
      "startPosition": 0,
      "endPosition": 3,
      "label": "Hook - fast pacing",
      "pace": "fast"
    }
  ],
  "hotspots": [
    {
      "position": 2,
      "type": "acceleration",
      "intensity": 70
    }
  ],
  "overall": "fast|slow|moderate|varied"
}

Identify 3-6 pacing segments (intro, content sections, conclusion) and 2-5 hotspots where pace changes significantly.`;

      const result = await generateWithAI(prompt, 'ollama', { temperature: 0.3 });
      const parsed = extractJson(result) as any;

      const validPaces = ['slow', 'moderate', 'fast', 'varied'];
      const validHotspotTypes = ['acceleration', 'deceleration', 'pause'];

      return {
        ...pattern,
        overall: validPaces.includes(parsed.overall) ? parsed.overall : pattern.overall,
        segments: Array.isArray(parsed.segments)
          ? parsed.segments.map((s: PacingSegment) => ({
              ...s,
              pace: ['slow', 'moderate', 'fast'].includes(s.pace) ? s.pace : 'moderate',
            }))
          : pattern.segments,
        hotspots: Array.isArray(parsed.hotspots)
          ? parsed.hotspots.map((h: PacingHotspot) => ({
              ...h,
              type: validHotspotTypes.includes(h.type) ? h.type : 'acceleration',
              intensity: Math.min(100, Math.max(0, h.intensity)),
            }))
          : pattern.hotspots,
      };
    } catch (err) {
      aiLogger.warn('AI pacing enhancement failed, using rule-based results', { error: (err as Error).message });
      return pattern;
    }
  }

  private calculateVariance(values: number[]): number {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
  }

  private classifyPace(wps: number, avgLen: number, variance: number): PacingPattern['overall'] {
    if (variance > 7) return 'varied';
    if (wps > 3.5 && avgLen < 12) return 'fast';
    if (wps < 1.5 && avgLen > 20) return 'slow';
    if (wps >= 2 && wps <= 3 && avgLen >= 10 && avgLen <= 20) return 'moderate';
    return 'varied';
  }

  private detectSegments(sentences: string[], lengths: number[]): PacingSegment[] {
    if (sentences.length < 6) {
      return [{
        startPosition: 0,
        endPosition: sentences.length - 1,
        label: 'Full transcript',
        pace: this.classifyPace(
          lengths.reduce((a, b) => a + b, 0) / (sentences.length * 0.35),
          lengths.reduce((a, b) => a + b, 0) / lengths.length,
          this.calculateVariance(lengths),
        ),
      }];
    }

    const segments: PacingSegment[] = [];
    const segmentSize = Math.max(3, Math.floor(sentences.length / 4));

    const labels = ['Introduction', 'Early content', 'Middle section', 'Conclusion'];
    for (let i = 0; i < 4; i++) {
      const start = i * segmentSize;
      const end = Math.min(sentences.length - 1, start + segmentSize - 1);
      if (start >= sentences.length) break;

      const segLengths = lengths.slice(start, end + 1);
      const avgLen = segLengths.reduce((a, b) => a + b, 0) / segLengths.length;
      const segWps = avgLen / 0.35;
      const segVar = this.calculateVariance(segLengths);

      segments.push({
        startPosition: start,
        endPosition: end,
        label: labels[i] || `Segment ${i + 1}`,
        pace: this.classifyPace(segWps, avgLen, segVar),
      });
    }

    return segments;
  }

  private detectHotspots(sentences: string[], lengths: number[]): PacingHotspot[] {
    const hotspots: PacingHotspot[] = [];

    for (let i = 1; i < lengths.length - 1; i++) {
      const prevLen = lengths[i - 1];
      const currLen = lengths[i];
      const nextLen = lengths[i + 1];

      if (Math.abs(currLen - prevLen) > 8 && Math.abs(currLen - nextLen) > 8) {
        hotspots.push({
          position: i,
          type: currLen < prevLen ? 'acceleration' : 'deceleration',
          intensity: Math.min(100, Math.abs(currLen - prevLen) * 8),
        });
      }
    }

    for (let i = 0; i < sentences.length - 1; i++) {
      if (sentences[i].length < 5 && sentences[i + 1].length > 50) {
        hotspots.push({
          position: i,
          type: 'pause',
          intensity: 60,
        });
      }
    }

    return hotspots.slice(0, 10);
  }
}
