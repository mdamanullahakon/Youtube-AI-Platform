import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJson, extractJsonArray } from '../utils/parse-ai-response';

export interface RetentionAnalysis {
  overallRetentionScore: number;
  hookRetentionScore: number;
  pacingRetentionScore: number;
  patternInterruptScore: number;
  curiosityLoopScore: number;
  predictedRetention: number;
  retentionThreshold: number;
  passesThreshold: boolean;
  patternInterrupts: { position: number; text: string; type: string }[];
  dropOffRisks: { second: number; risk: string; severity: string }[];
  weaknesses: string[];
  improvements: string[];
}

export class RetentionEngine {
  private readonly RETENTION_THRESHOLD = 55;
  private readonly PATTERN_INTERVAL_SECONDS = 25;

  async analyzeAndOptimizeScript(scriptContent: string, format: string): Promise<{ script: string; analysis: RetentionAnalysis }> {
    logger.info('[Retention Engine] Analyzing script for retention optimization');

    const analysis = await this.scoreScriptRetention(scriptContent, format);

    if (!analysis.passesThreshold) {
      logger.warn(`[Retention Engine] Script FAILS retention threshold (${analysis.overallRetentionScore} < ${analysis.retentionThreshold}). Optimizing...`);
      const optimized = await this.injectRetentionHooks(scriptContent, analysis);
      const reAnalysis = await this.scoreScriptRetention(optimized, format);

      if (!reAnalysis.passesThreshold) {
        const reOptimized = await this.forceRestructureScript(optimized, format, reAnalysis);
        const finalAnalysis = await this.scoreScriptRetention(reOptimized, format);

        if (!finalAnalysis.passesThreshold) {
          logger.error(`[Retention Engine] Script cannot meet retention threshold even after double optimization. Rejecting.`);
          throw new Error(`SCRIPT_REJECTED: Predicted retention ${finalAnalysis.overallRetentionScore}% below threshold ${finalAnalysis.retentionThreshold}%. Regenerate with different approach.`);
        }
        return { script: reOptimized, analysis: finalAnalysis };
      }
      return { script: optimized, analysis: reAnalysis };
    }

    return { script: scriptContent, analysis };
  }

  private async scoreScriptRetention(scriptContent: string, format: string): Promise<RetentionAnalysis> {
    const response = await generateWithAI(`
      You are a YouTube retention optimization expert. Analyze this script for WATCH TIME.

      Format: ${format}
      Script content:
      "${scriptContent.substring(0, 5000)}"

      Score each dimension 0-100 and detect exact retention elements:

      Return JSON with EXACT structure:
      {
        "hookRetentionScore": 0-100,
        "pacingRetentionScore": 0-100,
        "patternInterruptScore": 0-100,
        "curiosityLoopScore": 0-100,
        "predictedRetention": 0-100,
        "patternInterrupts": [
          {"position": 15, "text": "But what if I told you...", "type": "curiosity-gap"}
        ],
        "dropOffRisks": [
          {"second": 120, "risk": "Slow explanation section", "severity": "high"}
        ],
        "weaknesses": ["specific weakness"],
        "improvements": ["specific fix"]
      }

      Scoring rules:
      - hookRetentionScore: First 30 seconds must hook intensely
      - pacingRetentionScore: Every 20-30 seconds needs a mini-hook or pattern interrupt
      - patternInterruptScore: Unexpected changes that reset attention
      - curiosityLoopScore: Information gaps that keep viewers watching
      - predictedRetention: Overall predicted watch time %

      Pattern interrupts must occur every 20-30 SECONDS minimum.
      Critical: Scripts without pattern interrupts for 30+ seconds lose 50% of viewers.

      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.3 });

    try {
      const parsed = extractJson(response) as any;

      const hookRetentionScore = this.clampScore(parsed.hookRetentionScore);
      const pacingRetentionScore = this.clampScore(parsed.pacingRetentionScore);
      const patternInterruptScore = this.clampScore(parsed.patternInterruptScore);
      const curiosityLoopScore = this.clampScore(parsed.curiosityLoopScore);
      const predictedRetention = this.clampScore(parsed.predictedRetention);

      const overallRetentionScore = Math.round(
        hookRetentionScore * 0.30 +
        pacingRetentionScore * 0.25 +
        patternInterruptScore * 0.20 +
        curiosityLoopScore * 0.25
      );

      const finalPredictedRetention = predictedRetention > 0 ? predictedRetention : overallRetentionScore;
      const passesThreshold = finalPredictedRetention >= this.RETENTION_THRESHOLD;

      return {
        overallRetentionScore,
        hookRetentionScore,
        pacingRetentionScore,
        patternInterruptScore,
        curiosityLoopScore,
        predictedRetention: finalPredictedRetention,
        retentionThreshold: this.RETENTION_THRESHOLD,
        passesThreshold,
        patternInterrupts: Array.isArray(parsed.patternInterrupts) ? parsed.patternInterrupts.slice(0, 15) : [],
        dropOffRisks: Array.isArray(parsed.dropOffRisks) ? parsed.dropOffRisks.slice(0, 10) : [],
        weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
        improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
      };
    } catch (err) {
      logger.warn('[Retention Engine] Failed to parse retention score');
      return {
        overallRetentionScore: 50,
        hookRetentionScore: 50,
        pacingRetentionScore: 50,
        patternInterruptScore: 50,
        curiosityLoopScore: 50,
        predictedRetention: 50,
        retentionThreshold: this.RETENTION_THRESHOLD,
        passesThreshold: false,
        patternInterrupts: [],
        dropOffRisks: [],
        weaknesses: ['Failed to analyze'],
        improvements: ['Retry analysis'],
      };
    }
  }

  private async injectRetentionHooks(script: string, analysis: RetentionAnalysis): Promise<string> {
    const response = await generateWithAI(`
      OPTIMIZE this YouTube script to MAXIMIZE RETENTION.

      Current predicted retention: ${analysis.overallRetentionScore}%
      Target: ${analysis.retentionThreshold}%+

      Weaknesses to fix:
      ${analysis.weaknesses.map(w => `- ${w}`).join('\n')}

      CRITICAL RULES:
      - Insert pattern interrupts every 20-30 SECONDS
      - Pattern interrupts: sudden change in tone, "But wait...", "Here's where it gets crazy", "This changes everything"
      - Add curiosity gaps: tease what's coming next
      - Never go 25+ seconds without a hook, question, or surprise
      - Use emotional contrasts: calm → intense → calm
      - Shorten slow sections by 50%
      - Keep core message but make every sentence earn its place
      - Remove filler words, long explanations, redundant points

      Current script:
      "${script.substring(0, 5000)}"

      Return ONLY the improved script, no explanations, no JSON wrapper.
      Keep the same format and structure markers (---HOOK--- ---SCENES--- ---CTA---).
    `, 'ollama', { temperature: 0.6 });

    return response.trim().replace(/^```[\s\S]*?```/g, '').trim() || script;
  }

  private async forceRestructureScript(script: string, format: string, analysis: RetentionAnalysis): Promise<string> {
    const response = await generateWithAI(`
      This script FAILED retention optimization twice. COMPLETELY RESTRUCTURE it.

      Format: ${format}
      Current script:
      "${script.substring(0, 4000)}"

      PROBLEMS:
      ${analysis.weaknesses.map(w => `- ${w}`).join('\n')}

      NEW STRUCTURE REQUIREMENTS:
      1. Open with the MOST shocking/mysterious 5 seconds possible
      2. Every 20 seconds: a new micro-hook or reveal
      3. Use: "But here's the thing..." / "What happens next will shock you" / "This is where it gets interesting"
      4. Tease the ending: "The ending will surprise you..."
      5. Cut all fluff - every sentence must drive retention
      6. Use short sentences. Vary length. Create rhythm.
      7. Add [PAUSE] for dramatic effect every 60 seconds
      8. End with a curiosity loop that leads to next video

      Write a COMPLETELY NEW script following these rules.
      Structure: ---HOOK--- then ---SCENES--- then ---CTA---

      Return ONLY the new script.
    `, 'ollama', { temperature: 0.7 });

    return response.trim().replace(/^```[\s\S]*?```/g, '').trim() || script;
  }

  async analyzeRetentionDropPoints(projectId: string): Promise<{ second: number; dropRate: number }[]> {
    const analytics = await prisma.analytics.findUnique({ where: { projectId } });
    if (!analytics?.retention) return [];

    const learning = await prisma.analyticsLearning.findUnique({ where: { projectId } });
    if (learning?.dropOffPoints) {
      return (learning.dropOffPoints as any[]).map((d: any) => ({
        second: d.second || d.position || 0,
        dropRate: d.dropRate || d.severity === 'critical' ? 30 : d.severity === 'moderate' ? 15 : 5,
      }));
    }

    return [
      { second: 15, dropRate: 20 },
      { second: 60, dropRate: 15 },
      { second: 120, dropRate: 10 },
    ];
  }

  async getRetentionInsights(niche?: string): Promise<{ avgRetention: number; topDropOffSeconds: number[]; recommendedPatternFrequency: number }> {
    const projects = await prisma.videoProject.findMany({
      where: niche ? { topic: { contains: niche } } : {},
      include: { analytics: true, analyticsLearning: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const withRetention = projects.filter(p => p.analytics && p.analytics!.retention > 0);
    const avgRetention = withRetention.length > 0
      ? Math.round(withRetention.reduce((s, p) => s + p.analytics!.retention, 0) / withRetention.length)
      : 40;

    const dropOffs = new Set<number>();
    for (const p of withRetention) {
      if (p.analyticsLearning?.dropOffPoints) {
        for (const d of p.analyticsLearning.dropOffPoints as any[]) {
          if (d.second || d.position) dropOffs.add(d.second || d.position);
        }
      }
    }

    return {
      avgRetention,
      topDropOffSeconds: Array.from(dropOffs).sort((a, b) => a - b).slice(0, 5),
      recommendedPatternFrequency: avgRetention < 40 ? 20 : avgRetention < 60 ? 25 : 30,
    };
  }

  private clampScore(v: any): number {
    return Math.min(100, Math.max(0, typeof v === 'number' ? Math.round(v) : 50));
  }
}
