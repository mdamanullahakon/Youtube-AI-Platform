import { TranscriptIntelligenceService } from '../services/transcript-intelligence.service';
import { fetchTranscript, fetchMultipleTranscripts } from '../services/transcript.service';
import { aiLogger } from '../utils/logger';
import type { TranscriptIntelligenceResult } from '../types';

const intelligenceService = new TranscriptIntelligenceService();

export interface BatchAnalysisOptions {
  videoIds: string[];
  projectId?: string;
  enhanceWithAI?: boolean;
}

export interface TranscriptIntelligence {
  topHooks: string[];
  bestCTAs: string[];
  storytellingStructures: string[];
  averagePacing: number;
  emotionalPatterns: Record<string, number>;
  recommendations: string[];
  detailedAnalysis?: TranscriptIntelligenceResult;
  aggregatedAnalysis?: {
    avgHookScore: number;
    avgPacingScore: number;
    avgEngagementScore: number;
    avgViralPotential: number;
    topHooks: string[];
    commonPatterns: string[];
    overallRecommendations: string[];
  };
}

export async function analyzeCompetitorTranscripts(videoIds: string[]): Promise<TranscriptIntelligence> {
  aiLogger.info(`Analyzing ${videoIds.length} competitor transcripts with intelligence engine`);

  const transcripts = await fetchMultipleTranscripts(videoIds);

  if (transcripts.length === 0) {
    return {
      topHooks: [],
      bestCTAs: [],
      storytellingStructures: [],
      averagePacing: 0,
      emotionalPatterns: {},
      recommendations: ['No transcript data available'],
    };
  }

  const transcriptTexts = transcripts.map(t => ({
    videoId: t.videoId,
    text: t.transcript,
    title: t.title,
  }));

  const allHooks = transcripts.flatMap(t => t.hooks);
  const allCTAs = transcripts.map(t => t.callToAction).filter(Boolean);
  const pacingValues = transcripts.map(t => t.pacing).filter(p => p > 0);
  const emotionCounts: Record<string, number> = {};
  transcripts.forEach(t => {
    emotionCounts[t.emotionalTone] = (emotionCounts[t.emotionalTone] || 0) + 1;
  });

  const result = await intelligenceService.analyzeMultiple(transcriptTexts);

  return {
    topHooks: result.aggregated.topHooks.length > 0
      ? result.aggregated.topHooks
      : allHooks.slice(0, 5),
    bestCTAs: allCTAs.slice(0, 3),
    storytellingStructures: result.individual
      .map(r => r.storytellingStructure?.name)
      .filter(Boolean) as string[],
    averagePacing: pacingValues.length > 0
      ? Math.round(pacingValues.reduce((a, b) => a + b, 0) / pacingValues.length)
      : 0,
    emotionalPatterns: emotionCounts,
    recommendations: result.aggregated.overallRecommendations,
    detailedAnalysis: result.individual.length === 1 ? result.individual[0] : undefined,
    aggregatedAnalysis: result.aggregated,
  };
}

export async function analyzeSingleTranscript(
  transcriptText: string,
  sourceVideoIds?: string[],
  projectId?: string,
  enhanceWithAI: boolean = true,
): Promise<TranscriptIntelligenceResult> {
  return intelligenceService.analyze({
    transcript: transcriptText,
    sourceVideoIds,
    projectId,
    enhanceWithAI,
  });
}

export async function analyzeSingleByVideoId(
  videoId: string,
  projectId?: string,
): Promise<TranscriptIntelligenceResult | null> {
  const transcript = await fetchTranscript(videoId);
  if (!transcript) return null;

  return intelligenceService.analyze({
    transcript: transcript.transcript,
    sourceVideoIds: [videoId],
    projectId,
    enhanceWithAI: true,
  });
}
