import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJsonArray, extractJson } from '../utils/parse-ai-response';

export interface ViralPattern {
  hookStyle: string;
  hookTemplate: string;
  pacingDescription: string;
  storyPattern: string;
  emotionalArcTemplate: string;
  ctaPattern: string;
  thumbnailStyle: string;
  titleFormula: string;
  avgRetention: number;
  avgCTR: number;
  confidence: number;
}

export class ViralFeedbackLoop {
  async extractPatternsFromTopVideos(limit = 20): Promise<ViralPattern[]> {
    logger.info('[ViralFeedback] Extracting patterns from top performing videos');

    const topProjects = await prisma.videoProject.findMany({
      where: {
        analytics: { views: { gt: 0 } },
        uploadHistory: { status: 'published' },
      },
      include: {
        analytics: true,
        script: true,
        thumbnail: true,
        transcriptIntelligence: true,
        contentPerformance: true,
      },
      orderBy: { analytics: { views: 'desc' } },
      take: limit,
    });

    if (topProjects.length === 0) return [];

    const patterns: ViralPattern[] = [];

    for (const project of topProjects) {
      if (!project.analytics) continue;

      const retention = project.analytics.retention || 0;
      const ctr = project.analytics.ctr || 0;

      if (retention < 40 && ctr < 4) continue;

      const intelligence = project.transcriptIntelligence;
      const hookType = intelligence?.detectedHooks
        ? ((intelligence.detectedHooks as any[])[0]?.type || 'unknown')
        : 'unknown';
      const storyArc = intelligence?.storytellingStructure || 'unknown';
      const pacing = intelligence?.pacingPattern
        ? typeof intelligence.pacingPattern === 'string'
          ? intelligence.pacingPattern
          : JSON.stringify(intelligence.pacingPattern)
        : 'unknown';

      patterns.push({
        hookStyle: hookType,
        hookTemplate: project.script?.hook || '',
        pacingDescription: pacing,
        storyPattern: storyArc,
        emotionalArcTemplate: intelligence?.emotionalArc ? JSON.stringify(intelligence.emotionalArc) : '',
        ctaPattern: (intelligence?.detectedCTAs || [''])[0] || '',
        thumbnailStyle: project.thumbnail?.style || '',
        titleFormula: project.title || project.topic,
        avgRetention: retention,
        avgCTR: ctr,
        confidence: Math.min(1, (retention / 100 + ctr / 20) / 2),
      });
    }

    patterns.sort((a, b) => b.confidence - a.confidence);
    return patterns.slice(0, 10);
  }

  async getTopHookPatterns(limit = 5): Promise<string[]> {
    const patterns = await this.extractPatternsFromTopVideos(20);
    const hookMap = new Map<string, { templates: string[]; avgRet: number; count: number }>();

    for (const p of patterns) {
      if (!p.hookStyle || p.hookStyle === 'unknown') continue;
      const existing = hookMap.get(p.hookStyle) || { templates: [], avgRet: 0, count: 0 };
      existing.templates.push(p.hookTemplate);
      existing.avgRet += p.avgRetention;
      existing.count++;
      hookMap.set(p.hookStyle, existing);
    }

    const ranked = Array.from(hookMap.entries())
      .map(([style, data]) => ({ style, avgRetention: data.avgRet / data.count, count: data.count }))
      .sort((a, b) => b.avgRetention - a.avgRetention);

    return ranked.slice(0, limit).map(r => r.style);
  }

  async getTopStoryPatterns(limit = 3): Promise<string[]> {
    const patterns = await this.extractPatternsFromTopVideos(20);
    const storyMap = new Map<string, { avgRet: number; count: number }>();

    for (const p of patterns) {
      if (!p.storyPattern || p.storyPattern === 'unknown') continue;
      const existing = storyMap.get(p.storyPattern) || { avgRet: 0, count: 0 };
      existing.avgRet += p.avgRetention;
      existing.count++;
      storyMap.set(p.storyPattern, existing);
    }

    return Array.from(storyMap.entries())
      .map(([pattern, data]) => ({ pattern, avgRetention: data.avgRet / data.count }))
      .sort((a, b) => b.avgRetention - a.avgRetention)
      .slice(0, limit)
      .map(r => r.pattern);
  }

  async getTopPacingPatterns(limit = 3): Promise<string[]> {
    const patterns = await this.extractPatternsFromTopVideos(20);
    const pacingMap = new Map<string, { avgRet: number; count: number }>();

    for (const p of patterns) {
      if (!p.pacingDescription || p.pacingDescription === 'unknown') continue;
      const key = p.pacingDescription.includes('fast') ? 'fast-paced' :
        p.pacingDescription.includes('slow') ? 'slow-burn' : 'varied';
      const existing = pacingMap.get(key) || { avgRet: 0, count: 0 };
      existing.avgRet += p.avgRetention;
      existing.count++;
      pacingMap.set(key, existing);
    }

    return Array.from(pacingMap.entries())
      .map(([pace, data]) => ({ pace, avgRetention: data.avgRet / data.count }))
      .sort((a, b) => b.avgRetention - a.avgRetention)
      .slice(0, limit)
      .map(r => r.pace);
  }

  async generateScriptGuidanceFromPatterns(topic: string, niche?: string): Promise<string[]> {
    const [hooks, stories, pacings] = await Promise.all([
      this.getTopHookPatterns(3),
      this.getTopStoryPatterns(2),
      this.getTopPacingPatterns(2),
    ]);

    const guidance: string[] = [];

    if (hooks.length > 0) {
      guidance.push(`Use these proven hook styles: ${hooks.join(', ')}`);
    }
    if (stories.length > 0) {
      guidance.push(`Follow these winning story patterns: ${stories.join(', ')}`);
    }
    if (pacings.length > 0) {
      guidance.push(`Adopt this pacing strategy: ${pacings.join(', ')}`);
    }

    if (guidance.length === 0) {
      const response = await generateWithAI(`
        Based on YouTube best practices for "${topic}" in niche "${niche || 'general'}",
        provide 3 specific script generation guidelines for maximum retention.

        Return JSON array of 3 strings with specific, actionable advice.
      `, 'ollama', { temperature: 0.3 });

      try {
        const parsed = extractJsonArray<string>(response);
        if (parsed) return parsed;
      } catch {}
    }

    return guidance;
  }
}
