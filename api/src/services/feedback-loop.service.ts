import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJson, extractJsonArray } from '../utils/parse-ai-response';

export interface PostUploadAnalysis {
  projectId: string;
  performance: 'excellent' | 'good' | 'average' | 'poor';
  retentionScore: number;
  ctrScore: number;
  hookEffectiveness: number;
  pacingQuality: number;
  thumbnailQuality: number;
  titleQuality: number;
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
  patternInsights: string[];
}

export class FeedbackLoopService {
  async analyzeAfterUpload(projectId: string): Promise<PostUploadAnalysis | null> {
    logger.info(`Running post-upload analysis for project: ${projectId}`);

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        analytics: true,
        script: true,
        thumbnail: true,
        uploadHistory: true,
        contentPerformance: true,
        analyticsLearning: true,
        transcriptIntelligence: true,
      },
    });

    if (!project || !project.analytics) return null;

    const analytics = project.analytics;
    const views = analytics.views || 0;
    const ctr = analytics.ctr || 0;
    const retention = analytics.retention || 0;

    let performance: PostUploadAnalysis['performance'] = 'average';
    if (views > 10000 && ctr > 10 && retention > 60) performance = 'excellent';
    else if (views > 5000 && ctr > 5 && retention > 40) performance = 'good';
    else if (views < 500 || ctr < 2 || retention < 20) performance = 'poor';

    const analysis = await generateWithAI(`
      Post-upload analysis for YouTube video:

      Topic: ${project.topic}
      Views: ${views}
      CTR: ${ctr}%
      Retention: ${retention}%
      Performance: ${performance}

      Script: "${(project.script?.content || '').substring(0, 2000)}"

      Return JSON:
      {
        "retentionScore": 0-100,
        "ctrScore": 0-100,
        "hookEffectiveness": 0-100,
        "pacingQuality": 0-100,
        "thumbnailQuality": 0-100,
        "titleQuality": 0-100,
        "strengths": ["what worked well"],
        "weaknesses": ["what didn't work"],
        "improvements": ["specific improvements for next video"],
        "patternInsights": ["patterns detected that explain performance"]
      }

      Be BRUTALLY honest. Focus on actionable data.
      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.3 });

    try {
      const parsed = extractJson(analysis) as any;

      const result: PostUploadAnalysis = {
        projectId,
        performance,
        retentionScore: Math.min(100, Math.max(0, parsed.retentionScore || 50)),
        ctrScore: Math.min(100, Math.max(0, parsed.ctrScore || 50)),
        hookEffectiveness: Math.min(100, Math.max(0, parsed.hookEffectiveness || 50)),
        pacingQuality: Math.min(100, Math.max(0, parsed.pacingQuality || 50)),
        thumbnailQuality: Math.min(100, Math.max(0, parsed.thumbnailQuality || 50)),
        titleQuality: Math.min(100, Math.max(0, parsed.titleQuality || 50)),
        strengths: parsed.strengths || [],
        weaknesses: parsed.weaknesses || [],
        improvements: parsed.improvements || [],
        patternInsights: parsed.patternInsights || [],
      };

      const contentPerformance = project.contentPerformance;
      if (contentPerformance) {
        await prisma.contentPerformance.update({
          where: { id: contentPerformance.id },
          data: {
            hookGap: result.hookEffectiveness - (contentPerformance.predictedHookScore || 0),
            retentionGap: result.retentionScore - (contentPerformance.predictedRetention || 0),
          },
        });
      }

      return result;
    } catch {
      logger.warn(`Failed to parse post-upload analysis for ${projectId}`);
      return {
        projectId,
        performance,
        retentionScore: retention,
        ctrScore: ctr,
        hookEffectiveness: 50,
        pacingQuality: 50,
        thumbnailQuality: 50,
        titleQuality: 50,
        strengths: [],
        weaknesses: ['Analysis failed'],
        improvements: ['Manual review recommended'],
        patternInsights: [],
      };
    }
  }

  async generateScriptImprovements(projectId: string, analysis: PostUploadAnalysis): Promise<string[]> {
    if (analysis.performance === 'excellent') return [];

    const improvements = await generateWithAI(`
      Based on this video's performance analysis, generate specific script improvements:

      Performance: ${analysis.performance}
      Weaknesses: ${JSON.stringify(analysis.weaknesses)}
      Improvements suggested: ${JSON.stringify(analysis.improvements)}

      Generate 3 specific, actionable script-writing rules for the NEXT video:
      - Rules must be specific (not generic)
      - Rules must target the weaknesses found
      - Rules must be usable as prompt additions for AI script generation

      Return JSON array of 3 strings.
    `, 'ollama', { temperature: 0.3 });

    try {
      const parsed = extractJsonArray<string>(improvements);
      if (!parsed) throw new Error();
      return parsed;
    } catch {
      return analysis.improvements.slice(0, 3);
    }
  }

  async updateScriptPromptsBasedOnPerformance(projectId: string): Promise<void> {
    const analysis = await this.analyzeAfterUpload(projectId);
    if (!analysis) return;

    const improvements = await this.generateScriptImprovements(projectId, analysis);

    const promptInsight = await prisma.contentInsight.create({
      data: {
        category: 'general',
        content: improvements.join(' | '),
        source: 'performance-correlation',
        confidence: analysis.performance === 'excellent' ? 0.8 : 0.4,
        applicationCount: 0,
      },
    });

    logger.info(`Feedback loop: stored ${improvements.length} improvements as insight ${promptInsight.id}`);
  }
}
