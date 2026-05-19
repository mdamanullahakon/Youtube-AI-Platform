import { google } from 'googleapis';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/db';
import { env } from '../config/env';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJsonArray } from '../utils/parse-ai-response';

export interface CompetitorChannel {
  channelId: string;
  title: string;
  subscriberCount: number;
  videoCount: number;
  niche: string;
  avgViews: number;
  topVideos: CompetitorVideo[];
  patterns: CompetitorPatterns;
}

export interface CompetitorVideo {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  duration: string;
  publishedAt: string;
  tags: string[];
  description: string;
}

export interface CompetitorPatterns {
  titlePatterns: string[];
  thumbnailPatterns: string[];
  avgVideoLength: number;
  hookStrategies: string[];
  pacingStyle: string;
  retentionScore: number;
  uploadFrequency: string;
  strengths: string[];
  weaknesses: string[];
  contentGaps: string[];
}

export interface CompetitiveAnalysis {
  niche: string;
  analyzedAt: string;
  channels: CompetitorChannel[];
  globalPatterns: {
    winningTitles: string[];
    winningThumbnails: string[];
    avgBestLength: number;
    commonHooks: string[];
    commonPacing: string;
    uploadCadence: string;
  };
  contentOpportunities: string[];
  recommendations: string[];
}

export class CompetitorIntelligenceEngine {
  async analyzeNiche(niche: string, channelCount: number = 5): Promise<CompetitiveAnalysis> {
    logger.info(`[CompetitorIntel] Analyzing niche: "${niche}" (${channelCount} channels)`);

    const channels = await this.findTopChannels(niche, channelCount);
    const analyzedChannels: CompetitorChannel[] = [];

    for (const ch of channels) {
      const topVideos = await this.getChannelTopVideos(ch.channelId!, ch.title!);
      const patterns = await this.analyzePatterns(topVideos, niche);
      analyzedChannels.push({
        channelId: ch.channelId!,
        title: ch.title!,
        subscriberCount: ch.subscriberCount || 0,
        videoCount: ch.videoCount || 0,
        niche,
        avgViews: topVideos.reduce((s, v) => s + (v.viewCount || 0), 0) / Math.max(1, topVideos.length),
        topVideos,
        patterns,
      });
    }

    const globalPatterns = this.deriveGlobalPatterns(analyzedChannels);
    const contentOpportunities = await this.findContentGaps(analyzedChannels, niche);
    const recommendations = await this.generateRecommendations(analyzedChannels, niche, contentOpportunities);

    await this.saveAnalysis(niche, analyzedChannels, globalPatterns, recommendations);

    logger.info(`[CompetitorIntel] Analysis complete: ${analyzedChannels.length} channels, ${contentOpportunities.length} gaps, ${recommendations.length} recommendations`);

    return {
      niche,
      analyzedAt: new Date().toISOString(),
      channels: analyzedChannels,
      globalPatterns,
      contentOpportunities,
      recommendations,
    };
  }

  async getLatestInsights(niche: string): Promise<CompetitiveAnalysis | null> {
    try {
      const saved = await prisma.trendResearch.findFirst({
        where: { topic: { contains: niche }, competitors: { not: Prisma.DbNull } },
        orderBy: { analyzedAt: 'desc' },
      });
      if (saved?.competitors) {
        return saved.competitors as any;
      }
      return null;
    } catch { return null; }
  }

  private async findTopChannels(niche: string, count: number): Promise<any[]> {
    if (!env.YOUTUBE_API_KEY) {
      logger.warn('[CompetitorIntel] No YouTube API key — using template analysis');
      return this.generateTemplateChannels(niche, count);
    }

    try {
      const youtube = google.youtube({ version: 'v3', auth: env.YOUTUBE_API_KEY });
      const searchResponse = await youtube.search.list({
        part: ['snippet'],
        q: `${niche} horror documentary`,
        type: ['channel'],
        maxResults: count,
        order: 'relevance',
      });

      const channelIds = searchResponse.data.items
        ?.map(i => i.snippet?.channelId)
        .filter(Boolean) as string[];

      if (!channelIds?.length) return this.generateTemplateChannels(niche, count);

      const channelsResponse = await youtube.channels.list({
        part: ['statistics', 'snippet'],
        id: channelIds,
      });

      return channelsResponse.data.items || this.generateTemplateChannels(niche, count);
    } catch (err: any) {
      logger.warn(`[CompetitorIntel] YouTube search failed: ${err.message}`);
      return this.generateTemplateChannels(niche, count);
    }
  }

  private async getChannelTopVideos(channelId: string, channelTitle: string): Promise<CompetitorVideo[]> {
    if (!env.YOUTUBE_API_KEY) return this.generateTemplateVideos(channelTitle);

    try {
      const youtube = google.youtube({ version: 'v3', auth: env.YOUTUBE_API_KEY });

      const searchResponse = await youtube.search.list({
        part: ['snippet'],
        channelId,
        order: 'viewCount',
        maxResults: 10,
        type: ['video'],
      });

      const videoIds = searchResponse.data.items
        ?.map(i => i.id?.videoId)
        .filter(Boolean) as string[];

      if (!videoIds?.length) return this.generateTemplateVideos(channelTitle);

      const videosResponse = await youtube.videos.list({
        part: ['statistics', 'snippet', 'contentDetails'],
        id: videoIds,
      });

      return (videosResponse.data.items || []).map(v => ({
        videoId: v.id!,
        title: v.snippet?.title || '',
        thumbnailUrl: v.snippet?.thumbnails?.high?.url || v.snippet?.thumbnails?.default?.url || '',
        viewCount: parseInt(v.statistics?.viewCount || '0'),
        likeCount: parseInt(v.statistics?.likeCount || '0'),
        commentCount: parseInt(v.statistics?.commentCount || '0'),
        duration: v.contentDetails?.duration || 'PT0S',
        publishedAt: v.snippet?.publishedAt || '',
        tags: v.snippet?.tags || [],
        description: v.snippet?.description || '',
      }));
    } catch {
      return this.generateTemplateVideos(channelTitle);
    }
  }

  private async analyzePatterns(videos: CompetitorVideo[], niche: string): Promise<CompetitorPatterns> {
    const titles = videos.map(v => v.title);
    const descriptions = videos.map(v => v.description);
    const durations = videos.map(v => this.parseDuration(v.duration));

    const response = await generateWithAI(`
      Analyze these YouTube videos in the "${niche}" niche for competitive intelligence.

      TOP VIDEOS (titles):
      ${titles.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

      DESCRIPTIONS (first 200 chars):
      ${descriptions.map((d, i) => `${i + 1}. "${d.substring(0, 200)}"`).join('\n')}

      DURATIONS (seconds): ${durations.join(', ')}

      Return EXACTLY as JSON array (no other text):
      [{
        "titlePatterns": ["list of common title structures"],
        "thumbnailPatterns": ["common visual elements in thumbnails"],
        "avgVideoLength": number,
        "hookStrategies": ["how they open videos"],
        "pacingStyle": "fast/moderate/slow narrative",
        "retentionScore": 0-100,
        "uploadFrequency": "weekly/biweekly/erratic",
        "strengths": ["what they do well"],
        "weaknesses": ["what they do poorly"],
        "contentGaps": ["topics they avoid or miss"]
      }]

      Be specific and actionable. This feeds an AI video generation system.
    `, 'ollama', { temperature: 0.3 });

    try {
      const parsed = extractJsonArray<any>(response);
      if (parsed && parsed.length > 0) return parsed[0];
    } catch {}

    return {
      titlePatterns: ['Numbers lists', 'Curiosity gaps', 'Question hooks'],
      thumbnailPatterns: ['Face close-ups', 'Red/black contrast', 'Text overlays'],
      avgVideoLength: Math.round(durations.reduce((s, d) => s + d, 0) / Math.max(1, durations.length)),
      hookStrategies: ['Open with shocking statement', 'Ask rhetorical question'],
      pacingStyle: 'moderate',
      retentionScore: 60,
      uploadFrequency: 'weekly',
      strengths: ['Consistent upload schedule'],
      weaknesses: ['Repetitive thumbnail styles'],
      contentGaps: [`Under-explored sub-niches within ${niche}`],
    };
  }

  private deriveGlobalPatterns(channels: CompetitorChannel[]): CompetitiveAnalysis['globalPatterns'] {
    const allTitles = channels.flatMap(c => c.topVideos.map(v => v.title));
    const allDurations = channels.flatMap(c => c.topVideos.map(v => this.parseDuration(v.duration)));
    const allPatterns = channels.flatMap(c => c.patterns.thumbnailPatterns);

    return {
      winningTitles: allTitles.slice(0, 10),
      winningThumbnails: [...new Set(allPatterns)].slice(0, 5),
      avgBestLength: Math.round(allDurations.reduce((s, d) => s + d, 0) / Math.max(1, allDurations.length)),
      commonHooks: ['Cold open with question', 'Shocking statistic', 'Mystery setup'],
      commonPacing: 'Pattern interrupt every 30-45s',
      uploadCadence: '3-4 times per week',
    };
  }

  private async findContentGaps(channels: CompetitorChannel[], niche: string): Promise<string[]> {
    const allTitles = channels.flatMap(c => c.topVideos.map(v => v.title.toLowerCase()));
    const topicClusters = new Map<string, number>();
    const gapKeywords = [
      'unsolved', 'mystery', 'psychological', 'analog', 'surveillance',
      'occult', 'forgotten', 'lost', 'hidden', 'banned',
    ];

    for (const title of allTitles) {
      for (const kw of gapKeywords) {
        if (title.includes(kw)) {
          topicClusters.set(kw, (topicClusters.get(kw) || 0) + 1);
        }
      }
    }

    const gaps: string[] = [];
    for (const kw of gapKeywords) {
      if ((topicClusters.get(kw) || 0) < channels.length) {
        gaps.push(`${kw} content in ${niche} is underserved`);
      }
    }

    gaps.push(`Combined ${niche} with modern analog/documentary style`);
    return gaps.slice(0, 8);
  }

  private async generateRecommendations(
    channels: CompetitorChannel[],
    niche: string,
    gaps: string[]
  ): Promise<string[]> {
    const response = await generateWithAI(`
      You are a YouTube growth strategist. Based on competitor analysis in "${niche}":

      Competitors: ${channels.map(c => `"${c.title}" (${c.subscriberCount} subs, avg ${Math.round(c.avgViews)} views)`).join(', ')}

      Content gaps: ${gaps.join('; ')}

      Generate 5 specific, actionable recommendations to OUTPERFORM these competitors.
      Focus on: title strategies, thumbnail improvements, pacing changes, topic selection.

      Return as JSON array of strings.
    `, 'ollama', { temperature: 0.5 });

    try {
      const parsed = extractJsonArray<string>(response);
      if (parsed?.length) return parsed;
    } catch {}

    return [
      `Use curiosity-gap titles with numbers — competitors underuse this`,
      `Add face close-ups to thumbnails with extreme emotion`,
      `Increase upload frequency to 3x/week to outpace competitors`,
      `Cover ${gaps[0] || 'underserved topics'} — zero competition`,
      `Insert pattern interrupts every 25s vs competitors' 40s`,
    ];
  }

  private async saveAnalysis(
    niche: string,
    channels: CompetitorChannel[],
    patterns: CompetitiveAnalysis['globalPatterns'],
    recommendations: string[]
  ): Promise<void> {
    try {
      await prisma.trendResearch.create({
        data: {
          projectId: `competitor_${Date.now()}`,
          topic: niche,
          viralScore: 0,
          competition: channels.length,
          audience: 'horror-content',
          format: 'long-form',
          trends: patterns as any,
          competitors: JSON.parse(JSON.stringify({ channels, recommendations, analyzedAt: new Date().toISOString() })) as any,
          source: 'competitor-intelligence',
        },
      });
    } catch (err: any) {
      logger.warn(`[CompetitorIntel] Save failed: ${err.message}`);
    }
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!match) return 600;
    const hours = parseInt(match[1]?.replace('H', '') || '0');
    const minutes = parseInt(match[2]?.replace('M', '') || '0');
    const seconds = parseInt(match[3]?.replace('S', '') || '0');
    return hours * 3600 + minutes * 60 + seconds;
  }

  private generateTemplateChannels(niche: string, count: number): any[] {
    return Array.from({ length: count }, (_, i) => ({
      channelId: `template_ch_${i}`,
      title: [`The ${niche} Vault`, `${niche} Files`, `Dark ${niche}`, `${niche} Revealed`, `Beyond ${niche}`][i] || `${niche} Channel ${i + 1}`,
      subscriberCount: 500000 - i * 80000,
      videoCount: 200 - i * 30,
    }));
  }

  private generateTemplateVideos(channelTitle: string): CompetitorVideo[] {
    return Array.from({ length: 5 }, (_, i) => ({
      videoId: `template_vid_${Date.now()}_${i}`,
      title: [`The Truth About ${channelTitle} Nobody Talks About`, `I Investigated ${channelTitle} For 30 Days`, `This ${channelTitle} Video Will Haunt You`, `${i + 3} ${channelTitle} Mysteries`, `The Dark Side Of ${channelTitle}`][i] || `${channelTitle} Story #${i + 1}`,
      thumbnailUrl: '',
      viewCount: 500000 - i * 80000,
      likeCount: 30000 - i * 5000,
      commentCount: 5000 - i * 800,
      duration: `PT${12 + i * 2}M${30 + i * 15}S`,
      publishedAt: new Date(Date.now() - i * 86400000 * 7).toISOString(),
      tags: [channelTitle, 'horror', 'documentary'],
      description: `Full investigation into ${channelTitle}. All footage analyzed.`,
    }));
  }
}
