import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import { extractJson, extractJsonArray } from '../../utils/parse-ai-response';

export interface NicheOpportunity {
  niche: string;
  growthScore: number;
  competitionLevel: string;
  cpmEstimate: number;
  contentIdeas: string[];
  entryDifficulty: 'easy' | 'medium' | 'hard';
}

export interface ChannelCloneBlueprint {
  sourceChannelId: string;
  sourceNiche: string;
  targetNiche: string;
  targetChannelName: string;
  targetDescription: string;
  strategy: {
    hookStyle: string;
    thumbnailStyle: string;
    pacingStyle: string;
    storytellingArc: string;
    tone: string;
    avgDuration: string;
    uploadFrequency: string;
    colorPalette: string[];
  };
  predictedSuccess: number;
  estimatedMonthlyRevenue: number;
  contentStrategy: string[];
  brandingIdea: {
    channelName: string;
    description: string;
    profilePrompt: string;
    bannerPrompt: string;
  };
}

export interface ExpansionRecommendation {
  niche: string;
  rationale: string;
  expectedPerformance: number;
  similarToWinningChannel: string;
}

export class GrowthAI {
  async detectWinningNiches(userId: string): Promise<NicheOpportunity[]> {
    const channels = await prisma.youTubeAccount.findMany({
      where: { userId, isConnected: true },
    });

    const nicheScores: Record<string, { totalRevenue: number; totalViews: number; count: number }> = {};

    for (const channel of channels) {
      const projects = await prisma.videoProject.findMany({
        where: { channelId: channel.channelId, uploadHistory: { status: 'published' } },
        include: { analytics: true, monetizationConversion: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      const strategy = await prisma.contentStrategy.findFirst({
        where: { channelId: channel.channelId },
        orderBy: { createdAt: 'desc' },
      });
      const niche = strategy?.niche || 'general';

      if (!nicheScores[niche]) {
        nicheScores[niche] = { totalRevenue: 0, totalViews: 0, count: 0 };
      }

      for (const p of projects) {
        const views = p.analytics?.views || 0;
        nicheScores[niche].totalViews += views;
        nicheScores[niche].totalRevenue += (views / 1000) * 5;
        const convs = p.monetizationConversion || [];
        if (Array.isArray(convs)) {
          nicheScores[niche].totalRevenue += convs.reduce((s: number, c: any) => s + (c.revenue || 0), 0);
        }
      }
      nicheScores[niche].count += projects.length;
    }

    const opportunities: NicheOpportunity[] = [];
    const cpmByNiche: Record<string, number> = {
      'finance': 12, 'business': 10, 'technology': 8, 'ai': 9,
      'health': 7, 'education': 6, 'entertainment': 4, 'gaming': 3.5,
      'lifestyle': 5, 'horror': 4.5, 'comedy': 3, 'music': 2.5,
    };

    for (const [niche, data] of Object.entries(nicheScores)) {
      if (data.count === 0) continue;
      const avgRevenue = data.totalRevenue / Math.max(1, data.count);
      const growthScore = Math.min(100, Math.round(
        (Math.min(data.totalViews, 100000) / 1000) +
        (avgRevenue * 10) +
        ((cpmByNiche[niche] || 4) * 5)
      ));

      opportunities.push({
        niche,
        growthScore,
        competitionLevel: growthScore > 70 ? 'high' : growthScore > 40 ? 'medium' : 'low',
        cpmEstimate: cpmByNiche[niche] || 4,
        contentIdeas: [],
        entryDifficulty: growthScore > 70 ? 'hard' : growthScore > 40 ? 'medium' : 'easy',
      });
    }

    opportunities.sort((a, b) => b.growthScore - a.growthScore);
    return opportunities;
  }

  async cloneWinningStrategy(sourceChannelId: string, targetNiche: string): Promise<ChannelCloneBlueprint | null> {
    const sourceChannel = await prisma.youTubeAccount.findFirst({
      where: { channelId: sourceChannelId },
    });
    if (!sourceChannel) return null;

    const sourceStrategy = await prisma.contentStrategy.findFirst({
      where: { channelId: sourceChannelId },
      orderBy: { createdAt: 'desc' },
    });

    const topProjects = await prisma.videoProject.findMany({
      where: { channelId: sourceChannelId, uploadHistory: { status: 'published' } },
      include: { analytics: true, script: true },
      orderBy: { analytics: { views: 'desc' } },
      take: 5,
    });

    const aiPrompt = `You are a YouTube channel growth strategist.

Source Channel: ${sourceChannel.channelTitle || 'Unknown'}
Source Niche: ${sourceStrategy?.niche || 'unknown'}
Target Niche: ${targetNiche}

Source Strategy:
- Hook Style: ${sourceStrategy?.hookStyle || 'curiosity-gap'}
- Thumbnail Style: ${sourceStrategy?.thumbnailStyle || 'face-closeup-shock'}
- Pacing Style: ${sourceStrategy?.pacingStyle || 'fast-paced'}
- Tone: ${sourceStrategy?.tone || 'emotional-curiosity'}
- Storytelling Arc: ${sourceStrategy?.storytellingArc || 'problem-solution'}
- Avg Duration: ${sourceStrategy?.avgDuration || '8-10min'}
- CTA Style: ${sourceStrategy?.ctaStyle || 'direct'}
- Color Palette: ${sourceStrategy?.colorPalette || 'bold, high contrast'}
- Font Style: ${sourceStrategy?.fontStyle || 'modern sans-serif'}

Top performing video titles:
${topProjects.map(p => `- "${p.title}" (Views: ${p.analytics?.views || 0}, CTR: ${p.analytics?.ctr || 0}%)`).join('\n')}

Create a channel expansion blueprint that adapts the winning strategy for the target niche "${targetNiche}".

Return JSON:
{
  "sourceChannelId": "${sourceChannelId}",
  "sourceNiche": "${sourceStrategy?.niche || 'unknown'}",
  "targetNiche": "${targetNiche}",
  "targetChannelName": "creative channel name for ${targetNiche}",
  "targetDescription": "SEO-optimized channel description",
  "strategy": {
    "hookStyle": "adapted hook style for target niche",
    "thumbnailStyle": "adapted thumbnail style for target niche",
    "pacingStyle": "adapted pacing for target niche",
    "storytellingArc": "adapted arc for target niche",
    "tone": "adapted tone for target niche audience",
    "avgDuration": "optimal duration for target niche",
    "uploadFrequency": "recommended frequency",
    "colorPalette": ["primary color", "secondary color", "accent color"]
  },
  "predictedSuccess": 75,
  "estimatedMonthlyRevenue": 500,
  "contentStrategy": ["strategy point 1", "strategy point 2", "strategy point 3"],
  "brandingIdea": {
    "channelName": "generated channel name",
    "description": "channel description text",
    "profilePrompt": "AI image prompt for profile picture",
    "bannerPrompt": "AI image prompt for banner"
  }
}`;

    const response = await generateWithAI(aiPrompt, 'ollama', { temperature: 0.7 });
    const blueprint = extractJson<ChannelCloneBlueprint>(response);

    if (blueprint) {
      blueprint.sourceChannelId = sourceChannelId;
      logger.info(`[GrowthAI] Clone blueprint generated: ${sourceChannel.channelTitle} → ${targetNiche}`);
    }

    return blueprint;
  }

  async findExpansionOpportunities(userId: string): Promise<ExpansionRecommendation[]> {
    const channels = await prisma.youTubeAccount.findMany({
      where: { userId, isConnected: true },
    });

    if (channels.length === 0) return [];

    const strategies = await Promise.all(
      channels.map(c =>
        prisma.contentStrategy.findFirst({
          where: { channelId: c.channelId },
          orderBy: { createdAt: 'desc' },
        })
      )
    );

    const niches = strategies.filter(Boolean).map(s => s!.niche).filter(Boolean);

    const aiPrompt = `Given these existing YouTube channel niches: ${niches.join(', ')}

Recommend 3-5 related niches for expansion that are:
1. Related to existing niches (leverage existing expertise)
2. High CPM (monetization potential)
3. Low to medium competition
4. Growing in popularity

Return JSON array:
[
  {
    "niche": "niche name",
    "rationale": "why this niche makes sense for expansion",
    "expectedPerformance": 75,
    "similarToWinningChannel": "existing channel niche it's similar to"
  }
]`;

    const response = await generateWithAI(aiPrompt, 'ollama', { temperature: 0.6 });
    const recommendations = extractJsonArray<ExpansionRecommendation>(response);

    if (recommendations && recommendations.length > 0) {
      recommendations.sort((a, b) => b.expectedPerformance - a.expectedPerformance);
      return recommendations;
    }

    return this.getFallbackNiches(niches[0] || 'technology');
  }

  async suggestChannelIdentity(niche: string): Promise<{
    channelName: string;
    description: string;
    branding: string[];
  }> {
    const aiPrompt = `Create a YouTube channel identity for the niche "${niche}".

Return JSON:
{
  "channelName": "creative, catchy channel name",
  "description": "SEO-optimized 2-3 sentence channel description",
  "branding": ["branding idea 1", "branding idea 2", "branding idea 3"]
}`;

    const response = await generateWithAI(aiPrompt, 'ollama', { temperature: 0.7 });
    const identity = extractJson<{ channelName: string; description: string; branding: string[] }>(response);

    return identity || {
      channelName: `${niche.charAt(0).toUpperCase() + niche.slice(1)} Hub`,
      description: `Welcome to the ultimate channel about ${niche}. We create content to help you master ${niche}.`,
      branding: [`${niche}-focused color scheme`, 'Clean minimalist logo', 'Consistent thumbnail template'],
    };
  }

  async autoGenerateContentStrategy(niche: string, channelId: string): Promise<void> {
    const aiPrompt = `Generate a content strategy for a YouTube channel in the "${niche}" niche.

Return JSON:
{
  "pacingStyle": "recommended pacing (fast-paced / slow-burn / varied)",
  "hookStyle": "recommended hook style",
  "thumbnailStyle": "recommended thumbnail style",
  "tone": "recommended tone",
  "avgDuration": "recommended average video duration",
  "uploadFrequency": "recommended upload frequency",
  "targetAudience": "target audience description",
  "ctaStyle": "recommended CTA style",
  "storytellingArc": "recommended storytelling arc",
  "colorPalette": "recommended color palette",
  "fontStyle": "recommended font style"
}`;

    const response = await generateWithAI(aiPrompt, 'ollama', { temperature: 0.6 });
    const strategy = extractJson<{
      pacingStyle: string; hookStyle: string; thumbnailStyle: string;
      tone: string; avgDuration: string; uploadFrequency: string;
      targetAudience: string; ctaStyle: string; storytellingArc: string;
      colorPalette: string; fontStyle: string;
    }>(response);

    if (strategy) {
      await prisma.contentStrategy.upsert({
        where: { niche },
        update: {
          channelId,
          pacingStyle: strategy.pacingStyle || 'fast-paced',
          hookStyle: strategy.hookStyle || 'curiosity-gap',
          thumbnailStyle: strategy.thumbnailStyle || 'face-closeup-shock',
          tone: strategy.tone || 'emotional-curiosity',
          avgDuration: strategy.avgDuration || '8-10min',
          uploadFrequency: strategy.uploadFrequency || 'daily',
          targetAudience: strategy.targetAudience,
          ctaStyle: strategy.ctaStyle || 'direct',
          storytellingArc: strategy.storytellingArc || 'problem-solution',
          colorPalette: strategy.colorPalette,
          fontStyle: strategy.fontStyle,
        },
        create: {
          niche,
          channelId,
          pacingStyle: strategy.pacingStyle || 'fast-paced',
          hookStyle: strategy.hookStyle || 'curiosity-gap',
          thumbnailStyle: strategy.thumbnailStyle || 'face-closeup-shock',
          tone: strategy.tone || 'emotional-curiosity',
          avgDuration: strategy.avgDuration || '8-10min',
          uploadFrequency: strategy.uploadFrequency || 'daily',
          targetAudience: strategy.targetAudience,
          ctaStyle: strategy.ctaStyle || 'direct',
          storytellingArc: strategy.storytellingArc || 'problem-solution',
          colorPalette: strategy.colorPalette,
          fontStyle: strategy.fontStyle,
        },
      });
      logger.info(`[GrowthAI] Content strategy auto-generated for ${niche}`);
    }
  }

  async getWinningChannels(userId: string): Promise<{ channelId: string; channelTitle: string; niche: string; score: number }[]> {
    const channels = await prisma.youTubeAccount.findMany({
      where: { userId, isConnected: true },
    });

    const results: { channelId: string; channelTitle: string; niche: string; score: number }[] = [];

    for (const channel of channels) {
      const projects = await prisma.videoProject.findMany({
        where: { channelId: channel.channelId, uploadHistory: { status: 'published' } },
        include: { analytics: true },
        take: 20,
      });

      const strategy = await prisma.contentStrategy.findFirst({
        where: { channelId: channel.channelId },
        orderBy: { createdAt: 'desc' },
      });

      const avgViews = projects.length > 0
        ? projects.reduce((s, p) => s + (p.analytics?.views || 0), 0) / projects.length
        : 0;
      const avgCTR = projects.length > 0
        ? projects.reduce((s, p) => s + (p.analytics?.ctr || 0), 0) / projects.length
        : 0;

      const score = Math.round((avgViews / 100) * 0.5 + avgCTR * 10 * 0.3 + (projects.length * 5) * 0.2);

      results.push({
        channelId: channel.channelId,
        channelTitle: channel.channelTitle || 'Unknown',
        niche: strategy?.niche || 'general',
        score,
      });
    }

    return results.sort((a, b) => b.score - a.score);
  }

  private getFallbackNiches(baseNiche: string): ExpansionRecommendation[] {
    const nicheMap: Record<string, string[]> = {
      'technology': ['ai-tools', 'software-reviews', 'tech-news', 'coding-tutorials', 'gadget-reviews'],
      'finance': ['passive-income', 'crypto', 'stock-market', 'personal-finance', 'real-estate'],
      'health': ['fitness', 'nutrition', 'mental-health', 'yoga', 'supplements'],
      'education': ['online-courses', 'study-tips', 'language-learning', 'skill-development'],
      'entertainment': ['movie-reviews', 'gaming', 'reaction-videos', 'comedy-skits'],
      'horror': ['true-crime', 'paranormal', 'creepy-stories', 'unsolved-mysteries'],
    };

    const related = nicheMap[baseNiche] || ['how-to', 'tutorials', 'reviews', 'educational', 'lifestyle'];
    return related.slice(0, 5).map((n, i) => ({
      niche: n,
      rationale: `Related to ${baseNiche} with growing audience demand`,
      expectedPerformance: 70 - i * 10,
      similarToWinningChannel: baseNiche,
    }));
  }
}
