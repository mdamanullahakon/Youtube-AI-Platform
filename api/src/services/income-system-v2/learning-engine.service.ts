import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import { postVideoComment, updateVideoMetadata } from '../youtube.service';
import { TopicEngine } from './topic-engine.service';
import { incomeTopicQueue } from './income.queue';
import {
  IncomeWinnerVideo,
  IncomeWinningPattern,
  IncomeAnalyticsSnapshot,
} from './types';

export class LearningEngine {
  private topicEngine: TopicEngine;

  constructor() {
    this.topicEngine = new TopicEngine();
  }

  async detectBestVideo(channelId: string, cycleId: string): Promise<IncomeWinnerVideo | null> {
    const videos = await this.getTodaysVideos(channelId, cycleId);
    if (!videos.length) return null;

    const scored = videos.map(v => ({
      ...v,
      score: this.calculateScore(v),
    }));

    scored.sort((a, b) => b.score - a.score);
    const winner = scored[0];

    if (winner.score > 0) {
      logger.info(`[LearningEngine] Best video for ${channelId} (cycle: ${cycleId}): "${winner.title}" (score: ${winner.score.toFixed(1)})`);
    }

    return winner;
  }

  async extractPatterns(winner: IncomeWinnerVideo): Promise<IncomeWinningPattern[]> {
    const patterns: IncomeWinningPattern[] = [];

    const hookPattern = await this.extractHookPattern(winner);
    if (hookPattern) patterns.push(hookPattern);

    const titlePattern = this.extractTitlePattern(winner);
    if (titlePattern) patterns.push(titlePattern);

    const thumbnailPattern = this.extractThumbnailPattern(winner);
    if (thumbnailPattern) patterns.push(thumbnailPattern);

    const topicPattern = this.extractTopicPattern(winner);
    if (topicPattern) patterns.push(topicPattern);

    for (const pattern of patterns) {
      await this.storePattern(pattern, winner.channelId);
    }

    logger.info(`[LearningEngine] Extracted ${patterns.length} patterns from "${winner.title}"`);
    return patterns;
  }

  async run12HourDecision(cycleId: string, channelId: string): Promise<void> {
    logger.info(`[LearningEngine] Running 12-hour decision for ${channelId} cycle ${cycleId}`);

    const outputs = await prisma.incomeVideoOutput.findMany({
      where: { channelId, cycleId, uploadStatus: 'uploaded' },
    });

    if (!outputs.length) {
      logger.warn(`[LearningEngine] No videos found for 12-hour decision`);
      return;
    }

    // Get 12-hour snapshots
    const decisions: Array<{ projectId: string; videoId: string; views: number; category: 'LOW' | 'MEDIUM' | 'HIGH' }> = [];

    for (const output of outputs) {
      const fullSnapshots = await prisma.incomeAnalyticsSnapshot.findMany({
        where: { projectId: output.projectId, snapshotType: 'full' },
        orderBy: { collectedAt: 'desc' },
        take: 1,
      });

      const latest = fullSnapshots[0];
      const views = latest?.views || 0;
      const ctr = latest?.ctr || 0;

      let category: 'LOW' | 'MEDIUM' | 'HIGH';
      if (views >= 100 || ctr >= 8) {
        category = 'HIGH';
      } else if (views >= 20 || ctr >= 3) {
        category = 'MEDIUM';
      } else {
        category = 'LOW';
      }

      decisions.push({ projectId: output.projectId, videoId: output.videoId || '', views, category });

      switch (category) {
        case 'LOW':
          await this.handleLowViewVideo(output);
          break;
        case 'MEDIUM':
          await this.handleMediumViewVideo(output, channelId);
          break;
        case 'HIGH':
          await this.handleHighViewVideo(output, channelId);
          break;
      }
    }

    for (const d of decisions) {
      logger.info(`[LearningEngine] 12h decision for ${d.videoId}: ${d.category} (${d.views} views)`);
    }
  }

  private async handleLowViewVideo(output: any): Promise<void> {
    logger.info(`[LearningEngine] LOW: Changing title+thumbnail for "${output.title}"`);

    const viralSuffixes = [
      ' (2026 Secret)',
      ' — Nobody Tells You This',
      ' (Shocking Truth)',
      ' — Must Watch!',
      ' (Full Guide)',
    ];
    const suffix = viralSuffixes[Math.floor(Math.random() * viralSuffixes.length)];
    const newTitle = (output.title.length > 55 - suffix.length
      ? output.title.substring(0, 55 - suffix.length)
      : output.title) + suffix;

    try {
      await updateVideoMetadata(output.videoId, { title: newTitle }, output.userId || undefined);
      await prisma.incomeVideoOutput.update({
        where: { projectId: output.projectId },
        data: { title: newTitle },
      });

      await postVideoComment(output.videoId,
        '🔄 I updated this video with a better title! What do you think? Drop a comment 👇',
        output.userId || undefined,
      );
    } catch (err: any) {
      logger.warn(`[LearningEngine] Failed to update low-view video ${output.videoId}: ${err.message}`);
    }
  }

  private async handleMediumViewVideo(output: any, channelId: string): Promise<void> {
    logger.info(`[LearningEngine] MEDIUM: Pushing similar content for "${output.title}"`);

    const pattern: IncomeWinningPattern = {
      patternType: 'topic-type',
      patternValue: this.topicEngine.constructor.name ? 'informational' : 'informational',
      niche: '',
      score: 50,
      sampleSize: 1,
      avgViews: 0,
      avgCtr: 0,
      avgRetention: 0,
      confidence: 0.5,
    };

    try {
      const replicationTopics = await this.topicEngine.generateReplicationTopics(pattern, 2);
      for (const topic of replicationTopics) {
        await incomeTopicQueue.add('replication-topic', {
          channelId,
          topic: topic.topic,
          niche: topic.niche,
          score: topic.totalScore,
          source: '12h-medium',
        });
      }
      logger.info(`[LearningEngine] ${replicationTopics.length} replication topics queued for medium performer`);
    } catch (err: any) {
      logger.warn(`[LearningEngine] Failed to generate replication topics: ${err.message}`);
    }
  }

  private async handleHighViewVideo(output: any, channelId: string): Promise<void> {
    logger.info(`[LearningEngine] HIGH: Duplicating strategy for "${output.title}"`);

    try {
      const winner: IncomeWinnerVideo = {
        projectId: output.projectId,
        videoId: output.videoId || '',
        channelId: output.channelId,
        title: output.title,
        topic: output.topic,
        niche: '',
        hook: output.hook || '',
        views: 100,
        ctr: 8,
        retention: 50,
        revenue: output.estimatedRevenue || 0,
        hookStyle: this.inferHookStyle(output.hook || ''),
        thumbnailStyle: output.thumbnailStyle || '',
        titleStyle: this.inferTitleStyle(output.title),
        topicType: this.inferTopicType(output.topic),
        score: 100,
      };

      await this.extractPatterns(winner);

      const patterns = await this.extractPatterns(winner);
      for (const p of patterns) {
        const replicationTopics = await this.topicEngine.generateReplicationTopics(p, 2);
        for (const topic of replicationTopics) {
          await incomeTopicQueue.add('replication-topic', {
            channelId,
            topic: topic.topic,
            niche: topic.niche,
            score: topic.totalScore,
            source: '12h-high',
            patternType: p.patternType,
            patternValue: p.patternValue,
          });
        }
      }
      logger.info(`[LearningEngine] High performer duplicated — replication topics queued`);
    } catch (err: any) {
      logger.warn(`[LearningEngine] Failed to duplicate high-view strategy: ${err.message}`);
    }
  }

  private async getTodaysVideos(
    channelId: string,
    cycleId: string,
  ): Promise<IncomeWinnerVideo[]> {
    const outputs = await prisma.incomeVideoOutput.findMany({
      where: {
        channelId,
        uploadStatus: 'uploaded',
        cycleId,
      },
    });

    const winners: IncomeWinnerVideo[] = [];
    for (const output of outputs) {
      const snapshots = await prisma.incomeAnalyticsSnapshot.findMany({
        where: { projectId: output.projectId },
        orderBy: { collectedAt: 'desc' },
        take: 2,
      });

      if (!snapshots.length) continue;

      const latest = snapshots[0] as unknown as IncomeAnalyticsSnapshot;

      winners.push({
        projectId: output.projectId,
        videoId: output.videoId || '',
        channelId: output.channelId,
        title: output.title,
        topic: output.topic,
        niche: '',
        hook: output.hook,
        views: latest.views,
        ctr: latest.ctr,
        retention: latest.retention,
        hookStyle: this.inferHookStyle(output.hook),
        thumbnailStyle: output.thumbnailStyle,
        titleStyle: this.inferTitleStyle(output.title),
        topicType: this.inferTopicType(output.topic),
        revenue: output.estimatedRevenue || 0,
        score: 0,
      });
    }

    return winners;
  }

  private calculateScore(video: IncomeWinnerVideo): number {
    const viewsScore = Math.log10(video.views + 1) * 15;
    const ctrScore = video.ctr * 8;
    const retentionScore = video.retention * 0.8;
    return viewsScore + ctrScore + retentionScore;
  }

  private async extractHookPattern(winner: IncomeWinnerVideo): Promise<IncomeWinningPattern | null> {
    const prompt = `Analyze this YouTube video hook and classify its pattern:
Hook: "${winner.hook.substring(0, 200)}"

Classify into one of these hook patterns:
- curiosity-gap: creates mystery
- numbers-list: "Top 5", "3 ways"
- challenge: "Can you believe..."
- shocking-fact: starts with surprising stat
- question: directly asks viewer
- story: begins with narrative
- promise: "I'm going to show you..."

Return ONLY the pattern name.`;

    try {
      const raw = await generateWithAI(prompt, 'ollama', { temperature: 0.3, maxTokens: 50 });
      const pattern = raw.trim().toLowerCase();
      const validPatterns = ['curiosity-gap', 'numbers-list', 'challenge', 'shocking-fact', 'question', 'story', 'promise'];

      if (validPatterns.includes(pattern)) {
        return {
          patternType: 'hook-style',
          patternValue: pattern,
          niche: '',
          score: winner.score,
          sampleSize: 1,
          avgViews: winner.views,
          avgCtr: winner.ctr,
          avgRetention: winner.retention,
          confidence: 0.5,
        };
      }
    } catch {
      // fallback to default
    }

    return null;
  }

  private extractTitlePattern(winner: IncomeWinnerVideo): IncomeWinningPattern | null {
    const title = winner.title;
    let patternValue = 'normal';

    if (title.includes('How to') || title.includes('how to')) patternValue = 'how-to';
    else if (/\d+/.test(title)) patternValue = 'numbered';
    else if (title.includes(' vs ')) patternValue = 'comparison';
    else if (title.includes('?')) patternValue = 'question';
    else if (title.includes('The ')) patternValue = 'definitive';
    else if (title.includes('Best')) patternValue = 'best-of';
    else if (title.includes('Top')) patternValue = 'top-list';
    else if (title.includes('Secret') || title.includes('Nobody')) patternValue = 'curiosity';

    return {
      patternType: 'title-style',
      patternValue,
      niche: '',
      score: winner.score,
      sampleSize: 1,
      avgViews: winner.views,
      avgCtr: winner.ctr,
      avgRetention: winner.retention,
      confidence: 0.5,
    };
  }

  private extractThumbnailPattern(winner: IncomeWinnerVideo): IncomeWinningPattern | null {
    return {
      patternType: 'thumbnail-style',
      patternValue: winner.thumbnailStyle,
      niche: '',
      score: winner.score,
      sampleSize: 1,
      avgViews: winner.views,
      avgCtr: winner.ctr,
      avgRetention: winner.retention,
      confidence: 0.5,
    };
  }

  private extractTopicPattern(winner: IncomeWinnerVideo): IncomeWinningPattern | null {
    return {
      patternType: 'topic-type',
      patternValue: winner.topicType,
      niche: '',
      score: winner.score,
      sampleSize: 1,
      avgViews: winner.views,
      avgCtr: winner.ctr,
      avgRetention: winner.retention,
      confidence: 0.5,
    };
  }

  private async storePattern(pattern: IncomeWinningPattern, channelId: string): Promise<void> {
    const existing = await prisma.incomeWinnerPattern.findFirst({
      where: {
        patternType: pattern.patternType,
        patternValue: pattern.patternValue,
        channelId,
      },
    });

    if (existing) {
      const newSampleSize = existing.sampleSize + 1;
      await prisma.incomeWinnerPattern.update({
        where: { id: existing.id },
        data: {
          sampleSize: newSampleSize,
          avgViews: (existing.avgViews * existing.sampleSize + pattern.avgViews) / newSampleSize,
          avgCtr: (existing.avgCtr * existing.sampleSize + pattern.avgCtr) / newSampleSize,
          avgRetention: (existing.avgRetention * existing.sampleSize + pattern.avgRetention) / newSampleSize,
          score: (existing.score * existing.sampleSize + pattern.score) / newSampleSize,
          confidence: Math.min(1, 0.3 + (newSampleSize * 0.1)),
          lastUsedAt: new Date(),
        },
      });
    } else {
      await prisma.incomeWinnerPattern.create({
        data: {
          patternType: pattern.patternType,
          patternValue: pattern.patternValue,
          niche: pattern.niche,
          channelId,
          score: pattern.score,
          sampleSize: pattern.sampleSize,
          avgViews: pattern.avgViews,
          avgCtr: pattern.avgCtr,
          avgRetention: pattern.avgRetention,
          confidence: pattern.confidence,
        },
      });
    }
  }

  private inferHookStyle(hook: string): string {
    if (!hook) return 'default';
    if (hook.includes('How to') || hook.includes('how to')) return 'how-to';
    if (/\d+/.test(hook)) return 'numbered';
    if (hook.includes('?')) return 'question';
    if (hook.includes('!')) return 'exclamation';
    return 'curiosity';
  }

  private inferTitleStyle(title: string): string {
    if (title.includes('How to') || title.includes('how to')) return 'how-to';
    if (/\d+/.test(title)) return 'numbered';
    if (title.includes(' vs ')) return 'comparison';
    if (title.includes('?')) return 'question';
    if (title.includes('Best') || title.includes('Top')) return 'curated';
    if (title.includes('Secret') || title.includes('Nobody')) return 'curiosity';
    return 'declarative';
  }

  private inferTopicType(topic: string): string {
    const lower = topic.toLowerCase();
    if (lower.includes('how to') || lower.includes('guide') || lower.includes('tutorial')) return 'tutorial';
    if (lower.includes('best') || lower.includes('top') || lower.includes('vs')) return 'comparison';
    if (lower.includes('review') || lower.includes('unboxing')) return 'review';
    if (lower.includes('mistake') || lower.includes('avoid') || lower.includes('dont')) return 'warning';
    return 'informational';
  }
}