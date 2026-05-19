import { prisma } from '../config/db';
import { aiLogger } from '../utils/logger';
import { ViralHookDetector } from './viral-hook-detector';
import { RetentionLoopDetector } from './retention-loop-detector';
import { StorytellingAnalyzer } from './storytelling-analyzer';
import { PacingAnalyzer } from './pacing-analyzer';
import { HookQualityScorer } from './hook-scorer';
import { EngagementStructureScorer } from './engagement-scorer';
import { InsightGenerator } from './insight-generator';
import { LearningEngine } from './learning-engine';
import type {
  TranscriptIntelligenceResult,
  DetectedHook,
  RetentionLoop,
  PatternInterrupt,
  StorytellingStructure,
  PacingPattern,
  HookQualityScore,
  EngagementScore,
  EmotionalArc,
  ContentInsightType,
} from '../types';

export interface AnalyzeOptions {
  transcript: string;
  sourceVideoIds?: string[];
  projectId?: string;
  language?: string;
  enhanceWithAI?: boolean;
}

export class TranscriptIntelligenceService {
  private hookDetector: ViralHookDetector;
  private retentionDetector: RetentionLoopDetector;
  private storytellingAnalyzer: StorytellingAnalyzer;
  private pacingAnalyzer: PacingAnalyzer;
  private hookScorer: HookQualityScorer;
  private engagementScorer: EngagementStructureScorer;
  private insightGenerator: InsightGenerator;
  private learningEngine: LearningEngine;

  constructor() {
    this.hookDetector = new ViralHookDetector();
    this.retentionDetector = new RetentionLoopDetector();
    this.storytellingAnalyzer = new StorytellingAnalyzer();
    this.pacingAnalyzer = new PacingAnalyzer();
    this.hookScorer = new HookQualityScorer();
    this.engagementScorer = new EngagementStructureScorer();
    this.insightGenerator = new InsightGenerator();
    this.learningEngine = new LearningEngine();
  }

  async analyze(options: AnalyzeOptions): Promise<TranscriptIntelligenceResult> {
    const { transcript, sourceVideoIds = [], projectId = '', language = 'en', enhanceWithAI = true } = options;
    const sentences = transcript.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);

    aiLogger.info(`Starting transcript intelligence analysis: ${sentences.length} sentences, ${transcript.split(/\s+/).length} words`);

    // Phase 1: Hook detection
    let hooks: DetectedHook[] = await this.hookDetector.detectHooks(transcript);
    if (enhanceWithAI) {
      hooks = await this.hookDetector.enhanceWithAI(transcript, hooks);
    }

    // Phase 2: Retention loop & pattern interrupt detection
    let loops: RetentionLoop[] = this.retentionDetector.detectLoops(transcript);
    let interrupts: PatternInterrupt[] = this.retentionDetector.detectPatternInterrupts(transcript);
    if (enhanceWithAI) {
      const enhanced = await this.retentionDetector.enhanceWithAI(transcript, loops, interrupts);
      loops = enhanced.loops;
      interrupts = enhanced.interrupts;
    }

    // Phase 3: Storytelling structure analysis
    const structure: StorytellingStructure | null = this.storytellingAnalyzer.detectStructure(transcript);
    const narrativeArcScore: number = this.storytellingAnalyzer.scoreNarrativeArc(structure, sentences.length);
    let emotionalArc: EmotionalArc | null = null;
    if (enhanceWithAI) {
      emotionalArc = await this.storytellingAnalyzer.analyzeEmotionalArc(transcript);
    } else {
      emotionalArc = await this.storytellingAnalyzer.analyzeEmotionalArc(transcript);
    }

    // Phase 4: Pacing analysis
    let pacing: PacingPattern = this.pacingAnalyzer.analyze(transcript);
    if (enhanceWithAI) {
      pacing = await this.pacingAnalyzer.enhanceWithAI(transcript, pacing);
    }
    const pacingScore = this.pacingAnalyzer.scoreTranscription(
      pacing.wordsPerSecond,
      pacing.sentenceLengthAvg,
      pacing.sentenceLengthVariation,
    );

    // Phase 5: Scoring
    const hookQuality: HookQualityScore = this.hookScorer.scoreHooks(hooks);
    const engagementScore: EngagementScore = this.engagementScorer.score(
      hooks, loops, interrupts, structure, pacing, emotionalArc,
    );

    // Viral potential: weighted combination of key metrics
    const viralPotentialScore = Math.round(
      hookQuality.overall * 0.3 +
      engagementScore.overall * 0.25 +
      narrativeArcScore * 0.15 +
      pacingScore * 0.1 +
      hooks.length * 3 +
      Math.min(20, loops.length * 4)
    );

    // Extract CTAs
    const detectedCTAs = hooks
      .filter(h => {
        const l = h.text.toLowerCase();
        return /subscribe|like|comment|follow|share|check out|hit that|link|button/i.test(l);
      })
      .map(h => h.text);

    // CTA effectiveness
    const ctaEffectiveness = detectedCTAs.length > 0
      ? Math.min(100, engagementScore.overall * 0.4 + hooks.slice(-3).filter(h => detectedCTAs.includes(h.text)).length * 25)
      : 0;

    // Phase 6: Insight generation
    let insights: ContentInsightType[] = this.insightGenerator.generateRuleInsights(
      hooks, loops, interrupts, structure, pacing, hookQuality, engagementScore, emotionalArc,
    );
    if (enhanceWithAI) {
      insights = await this.insightGenerator.enhanceWithAI(transcript, insights);
    }

    // Phase 7: Learning engine - save insights for future use
    await this.learningEngine.saveInsights(insights);

    // Build result
    const result: TranscriptIntelligenceResult = {
      projectId,
      transcriptText: transcript.length > 10000 ? transcript.substring(0, 10000) + '...' : transcript,
      language,
      detectedHooks: hooks,
      hookScore: hooks.length > 0 ? hooks[0].score : 0,
      hookRecommendations: hookQuality.weaknesses.map(w =>
        `Improve: ${w}`
      ),
      hookQuality,
      retentionLoops: loops,
      patternInterrupts: interrupts,
      storytellingStructure: structure,
      narrativeArcScore,
      pacingPattern: pacing,
      pacingScore,
      engagementScore,
      viralPotentialScore: Math.min(100, viralPotentialScore),
      detectedCTAs,
      ctaEffectiveness,
      emotionalArc,
      insights,
      sourceVideoIds,
    };

    // Persist to database if projectId provided
    if (projectId) {
      await this.persistAnalysis(result);
    }

    aiLogger.info(`Transcript intelligence analysis complete. Viral potential: ${result.viralPotentialScore}/100, Insights: ${insights.length}`);

    return result;
  }

  async analyzeMultiple(transcripts: { videoId: string; text: string; title?: string }[]): Promise<{
    individual: TranscriptIntelligenceResult[];
    aggregated: {
      avgHookScore: number;
      avgPacingScore: number;
      avgEngagementScore: number;
      avgViralPotential: number;
      topHooks: string[];
      commonPatterns: string[];
      overallRecommendations: string[];
    };
  }> {
    const results: TranscriptIntelligenceResult[] = [];

    for (const t of transcripts) {
      const result = await this.analyze({
        transcript: t.text,
        sourceVideoIds: [t.videoId],
        enhanceWithAI: true,
      });
      results.push(result);
    }

    const avgHookScore = Math.round(
      results.reduce((s, r) => s + r.hookScore, 0) / results.length
    );
    const avgPacingScore = Math.round(
      results.reduce((s, r) => s + r.pacingScore, 0) / results.length
    );
    const avgEngagementScore = Math.round(
      results.reduce((s, r) => s + r.engagementScore.overall, 0) / results.length
    );
    const avgViralPotential = Math.round(
      results.reduce((s, r) => s + r.viralPotentialScore, 0) / results.length
    );

    const topHooks = results
      .flatMap(r => r.detectedHooks)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(h => h.text);

    const commonPatterns = results
      .flatMap(r => r.retentionLoops)
      .reduce<{ type: string; count: number }[]>((acc, l) => {
        const existing = acc.find(a => a.type === l.type);
        if (existing) existing.count++;
        else acc.push({ type: l.type, count: 1 });
        return acc;
      }, [])
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(p => `${p.type} (${p.count}x)`);

    const overallRecommendations = results
      .flatMap(r => r.insights)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5)
      .map(i => i.content);

    return {
      individual: results,
      aggregated: {
        avgHookScore,
        avgPacingScore,
        avgEngagementScore,
        avgViralPotential,
        topHooks,
        commonPatterns,
        overallRecommendations,
      },
    };
  }

  private async persistAnalysis(result: TranscriptIntelligenceResult): Promise<void> {
    try {
      await prisma.transcriptIntelligence.upsert({
        where: { projectId: result.projectId },
        update: {
          transcriptText: result.transcriptText,
          language: result.language,
          detectedHooks: result.detectedHooks as any,
          hookScore: result.hookScore,
          hookRecommendations: result.hookRecommendations,
          retentionLoops: result.retentionLoops as any,
          patternInterrupts: result.patternInterrupts as any,
          storytellingStructure: result.storytellingStructure?.name || null,
          narrativeArcScore: result.narrativeArcScore,
          pacingScore: result.pacingScore,
          wordsPerSecond: result.pacingPattern?.wordsPerSecond || null,
          sentenceLengthAvg: result.pacingPattern?.sentenceLengthAvg || null,
          pacingPattern: result.pacingPattern as any,
          engagementScore: result.engagementScore.overall,
          viralPotentialScore: result.viralPotentialScore,
          detectedCTAs: result.detectedCTAs,
          ctaEffectiveness: result.ctaEffectiveness,
          emotionalArc: result.emotionalArc as any,
          insights: result.insights as any,
          sourceVideoIds: result.sourceVideoIds,
        },
        create: {
          projectId: result.projectId,
          transcriptText: result.transcriptText,
          language: result.language,
          detectedHooks: result.detectedHooks as any,
          hookScore: result.hookScore,
          hookRecommendations: result.hookRecommendations,
          retentionLoops: result.retentionLoops as any,
          patternInterrupts: result.patternInterrupts as any,
          storytellingStructure: result.storytellingStructure?.name || null,
          narrativeArcScore: result.narrativeArcScore,
          pacingScore: result.pacingScore,
          wordsPerSecond: result.pacingPattern?.wordsPerSecond || null,
          sentenceLengthAvg: result.pacingPattern?.sentenceLengthAvg || null,
          pacingPattern: result.pacingPattern as any,
          engagementScore: result.engagementScore.overall,
          viralPotentialScore: result.viralPotentialScore,
          detectedCTAs: result.detectedCTAs,
          ctaEffectiveness: result.ctaEffectiveness,
          emotionalArc: result.emotionalArc as any,
          insights: result.insights as any,
          sourceVideoIds: result.sourceVideoIds,
        },
      });
    } catch (err) {
      aiLogger.error('Failed to persist transcript intelligence', { error: (err as Error).message, projectId: result.projectId });
    }
  }

  async getScriptImprovements(topic: string, format: string) {
    return this.learningEngine.generateScriptImprovements(topic, format);
  }
}
