import { prisma } from '../config/db';
import { WinningPattern } from '@prisma/client';

/**
 * ViralLearningService
 * Scans analytics data to discover high‑performing videos and extracts
 * reusable patterns (hooks, titles, pacing, topics). The results are stored
 * in the `WinningPattern` table for consumption by the script generator.
 */
export class ViralLearningService {
  /**
   * Refresh the WinningPattern table based on the latest weekly performance.
   * Called daily (e.g., via a cron job).
   */
  static async refreshPatterns(): Promise<void> {
    // 1. Find top‑performing videos (CTR > 2% and watchTime > 5 minutes)
    const topVideos = await prisma.analytics.findMany({
      where: {
        ctr: { gt: 2 },
        watchTime: { gt: 300 },
      },
      orderBy: { ctr: 'desc' },
      take: 20,
    });

    // 2. For each video, pull related project data to extract hooks/titles.
    for (const analytics of topVideos) {
      const project = await prisma.videoProject.findUnique({
        where: { id: analytics.projectId },
        include: { script: true, thumbnail: true },
      });
      if (!project) continue;

      const hook = project.script?.hook ?? '';
      const title = project.title ?? '';
      const pacing = this._estimatePacing(project.script?.content ?? '');

      // 3. Upsert a WinningPattern entry.
      await prisma.winningPattern.upsert({
        where: { id: `${project.id}-${hook}` },
        update: {
          score: this._calculateScore(analytics),
          hitCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
        create: {
          id: `${project.id}-${hook}`,
          category: 'hook',
          niche: project.niche,
          content: hook,
          patternType: 'hook-structure',
          source: 'analytics',
          score: this._calculateScore(analytics),
          hitCount: 1,
          avgRetention: analytics.retention,
          avgCTR: analytics.ctr,
          confidence: 0.8,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
  }

  /**
   * Retrieve the best patterns for a given niche.
   */
  static async getBestPatterns(niche: string, limit = 5): Promise<WinningPattern[]> {
    return prisma.winningPattern.findMany({
      where: { niche, blocked: false },
      orderBy: { score: 'desc' },
      take: limit,
    });
  }

  // ---------- Private helpers ----------
  private static _calculateScore(analytics: any): number {
    // Simple weighted score: CTR (40%) + retention (30%) + watchTime (30%)
    const ctrWeight = 0.4;
    const retentionWeight = 0.3;
    const watchWeight = 0.3;
    const normalizedCtr = Math.min(analytics.ctr / 10, 1); // cap at 10%
    const normalizedRetention = Math.min(analytics.retention / 100, 1);
    const normalizedWatch = Math.min(analytics.watchTime / 600, 1); // cap at 10 mins
    return ctrWeight * normalizedCtr + retentionWeight * normalizedRetention + watchWeight * normalizedWatch;
  }

  private static _estimatePacing(content: string): string {
    // Very naive pacing estimator – counts words per minute based on length.
    const words = content.split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.round(words / 150)); // assume 150 wpm average
    return `${words} words / ${minutes} min`;
  }
}
