import { prisma } from '../config/db';
import { logger } from '../utils/logger';

interface WinningPattern {
  topic: string;
  titlePattern: string;
  hookStyle: string;
  avgCtr: number;
  avgRetention: number;
  sampleSize: number;
  score: number;
}

export class ViralLearningLoop {
  async recordPerformance(projectId: string, videoId: string): Promise<void> {
    try {
      const project = await prisma.videoProject.findUnique({
        where: { id: projectId },
        include: {
          script: true,
          analytics: true,
        },
      });
      if (!project) return;

      const ctr = project.analytics?.ctr || 0;
      const views = project.analytics?.views || 0;
      const retention = project.analytics?.retention || 0;
      const hookStyle = this.extractHookStyle(project.script?.content || '');

      await prisma.contentPerformance.upsert({
        where: { projectId },
        update: {
          actualViews: views,
          actualCTR: ctr,
          actualRetention: retention,
          actualWatchTime: project.analytics?.watchTime || 0,
          updatedAt: new Date(),
        },
        create: {
          projectId,
          actualViews: views,
          actualCTR: ctr,
          actualRetention: retention,
          actualWatchTime: project.analytics?.watchTime || 0,
        },
      }).catch(() => {});

      logger.info(`[ViralLearning] Recorded ${videoId}: CTR=${(ctr * 100).toFixed(1)}%, Views=${views}`);
    } catch (err: any) {
      logger.warn(`[ViralLearning] Could not record: ${err.message}`);
    }
  }

  async getBestPatterns(limit = 5): Promise<WinningPattern[]> {
    const records = await prisma.contentPerformance.findMany({
      where: { actualViews: { gt: 0 } },
      orderBy: { actualCTR: 'desc' },
      take: 50,
      include: {
        project: {
          select: {
            topic: true,
            title: true,
            script: { select: { content: true } },
          },
        },
      },
    });

    const grouped = new Map<string, { titlePatterns: string[]; hookStyles: string[]; ctrs: number[]; retentions: number[] }>();
    for (const r of records) {
      const topic = r.project?.topic || 'general';
      const key = topic.split(' ').slice(0, 2).join(' ');
      if (!grouped.has(key)) {
        grouped.set(key, { titlePatterns: [], hookStyles: [], ctrs: [], retentions: [] });
      }
      const g = grouped.get(key)!;
      g.titlePatterns.push(this.extractTitlePattern(r.project?.title || ''));
      g.hookStyles.push(this.extractHookStyle(r.project?.script?.content || ''));
      g.ctrs.push(r.actualCTR || 0);
      g.retentions.push(r.actualRetention || 0);
    }

    const results: WinningPattern[] = [];
    for (const [key, g] of grouped) {
      const avgCtr = g.ctrs.reduce((a, b) => a + b, 0) / g.ctrs.length;
      const avgRetention = g.retentions.reduce((a, b) => a + b, 0) / g.retentions.length;
      results.push({
        topic: key,
        titlePattern: this.mostCommon(g.titlePatterns),
        hookStyle: this.mostCommon(g.hookStyles),
        avgCtr,
        avgRetention,
        sampleSize: g.ctrs.length,
        score: avgCtr * 0.5 + avgRetention * 0.3 + Math.min(g.ctrs.length, 10) * 10,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async getBestTopicForToday(): Promise<string | null> {
    const patterns = await this.getBestPatterns(1);
    if (patterns.length === 0) return null;
    return patterns[0].topic;
  }

  async getBestTitlePattern(): Promise<string | null> {
    const patterns = await this.getBestPatterns(3);
    if (patterns.length === 0) return null;
    const titles = patterns.map(p => p.titlePattern).filter(Boolean);
    return this.mostCommon(titles) || null;
  }

  private extractHookStyle(content: string): string {
    const firstLine = content.split('\n')[0] || '';
    if (firstLine.includes('?')) return 'question';
    if (firstLine.includes('!')) return 'exclamation';
    if (firstLine.match(/^(how|why|what|when|where|who)/i)) return 'how-to';
    if (firstLine.match(/^(you|your)/i)) return 'direct-address';
    if (firstLine.match(/^\d+/)) return 'numbered';
    return 'statement';
  }

  private extractTitlePattern(title: string): string {
    return title
      .replace(/\d+/g, 'N')
      .replace(/['"]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private mostCommon(arr: string[]): string {
    const freq = new Map<string, number>();
    for (const item of arr) {
      if (!item) continue;
      freq.set(item, (freq.get(item) || 0) + 1);
    }
    let maxCount = 0;
    let mostCommon = '';
    for (const [item, count] of freq) {
      if (count > maxCount) { maxCount = count; mostCommon = item; }
    }
    return mostCommon;
  }
}
