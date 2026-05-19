import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { GodmodeOrchestrator, type VideoPlan, type MonetizationPlan, type MarketStrategy } from './godmode-orchestrator.service';
import { generateWithAI } from './ai.service';
import { extractJson } from '../utils/parse-ai-response';

export interface ChannelLaunchBlueprint {
  niche: string;
  language: string;
  channelName: string;
  channelDescription: string;
  branding: {
    profilePicPrompt: string;
    bannerPrompt: string;
    colorPalette: string[];
    fontStyle: string;
  };
  roadmap: VideoPlan[];
  uploadSchedule: {
    frequency: string;
    bestTimes: { bangladesh: string; global: string };
    contentMix: string;
  };
  monetization: MonetizationPlan;
  milestones: Milestone[];
  bangladeshStrategy?: MarketStrategy;
  globalStrategy?: MarketStrategy;
}

export interface Milestone {
  day: number;
  label: string;
  targetSubs: number;
  targetViews: number;
  actionItems: string[];
}

export class ChannelLaunchService {
  private orchestrator = new GodmodeOrchestrator();

  async generateLaunchBlueprint(
    niche: string,
    language: 'bangla' | 'english' | 'both' = 'english',
    channelName?: string,
  ): Promise<ChannelLaunchBlueprint> {
    logger.info(`ChannelLaunchService: generating launch blueprint for "${niche}"`);

    const plan = await this.orchestrator.getFullExecutionPlan(niche, language);
    const branding = await this.generateBranding(niche, language);
    const milestones = this.generateMilestones(niche, language);

    return {
      niche,
      language,
      channelName: channelName || this.generateChannelName(niche),
      channelDescription: this.generateChannelDescription(niche, language),
      branding,
      roadmap: plan.launchRoadmap,
      uploadSchedule: {
        frequency: 'Daily (first 30 days), then 5x/week',
        bestTimes: {
          bangladesh: '09:00 AM BDT (Sunday-Thursday)',
          global: '10:00 AM EST (Monday-Friday)',
        },
        contentMix: language === 'both'
          ? '60% Shorts (under 60s), 40% Longform (8-15 min)'
          : language === 'bangla'
          ? '80% Shorts, 20% Longform'
          : '40% Shorts, 60% Longform',
      },
      monetization: plan.monetizationStrategy,
      milestones,
      bangladeshStrategy: plan.bangladeshStrategy,
      globalStrategy: plan.globalStrategy,
    };
  }

  private async generateBranding(niche: string, language: string) {
    const result = await generateWithAI(`
      Generate YouTube channel branding for a ${language} channel in niche: "${niche}"

      Return JSON:
      {
        "profilePicPrompt": "detailed AI image generation prompt for channel profile picture",
        "bannerPrompt": "detailed AI image generation prompt for channel banner",
        "colorPalette": ["3 hex colors that work for this niche"],
        "fontStyle": "best font style for thumbnails in this niche"
      }

      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.4 });

    try {
      const parsed = extractJson(result) as any;
      if (!parsed) throw new Error();
      return parsed;
    } catch {
      return {
        profilePicPrompt: `Professional logo for ${niche} channel, minimalist design, bold colors`,
        bannerPrompt: `${niche} themed banner with channel name, dark background, accent colors`,
        colorPalette: ['#FF0000', '#000000', '#FFFFFF'],
        fontStyle: 'Bold sans-serif (Oswald, Bebas Neue, Montserrat)',
      };
    }
  }

  private generateChannelName(niche: string): string {
    const prefixes = ['AI', 'The', 'Next', 'Future', 'Smart', 'Ultimate', 'Pro', 'Genius'];
    const suffixes = ['Hub', 'Lab', 'Verse', 'Daily', 'Now', 'Insider', 'Academy', 'Pro'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = suffixes[Math.floor(Math.random() * suffixes.length)];
    const nicheWord = niche.split(' ')[0];
    return `${prefix}${nicheWord}${suffix}`;
  }

  private generateChannelDescription(niche: string, language: string): string {
    const langNote = language === 'bangla'
      ? 'We bring you the best content in Bangla, tailored for the Bangladeshi audience.'
      : language === 'both'
      ? 'We serve both Bangla and English audiences with premium content.'
      : 'We bring you world-class content in English.';

    return `${niche} content that educates, inspires, and entertains. ${langNote} New videos every week. Subscribe to join our growing community!`;
  }

  private generateMilestones(niche: string, language: string): Milestone[] {
    return [
      {
        day: 7, label: 'First Week Complete', targetSubs: 50, targetViews: 2000,
        actionItems: ['Post 7 videos', 'Analyze best performing content', 'Optimize thumbnail strategy'],
      },
      {
        day: 14, label: 'Two Week Streak', targetSubs: 150, targetViews: 8000,
        actionItems: ['Double down on winning format', 'Add end screens and cards', 'Engage with every comment'],
      },
      {
        day: 21, label: 'Three Week Optimization', targetSubs: 350, targetViews: 25000,
        actionItems: ['A/B test thumbnails', 'Improve retention based on analytics', 'Start community tab engagement'],
      },
      {
        day: 30, label: 'First Month Complete', targetSubs: 500, targetViews: 50000,
        actionItems: ['Review full 30-day analytics', 'Plan month 2 strategy', 'First affiliate link placements'],
      },
      {
        day: 60, label: 'Monetization Push', targetSubs: 1000, targetViews: 200000,
        actionItems: ['Apply for YPP', 'Launch digital product', 'First sponsor outreach'],
      },
      {
        day: 90, label: 'Revenue Active', targetSubs: 3000, targetViews: 500000,
        actionItems: ['Scale winning formats', 'Hire editor if needed', '$500+/month revenue target'],
      },
    ];
  }

  async generatePerformancePredictions(niche: string, language: string): Promise<{
    month1: { subs: number; views: number; revenue: number };
    month3: { subs: number; views: number; revenue: number };
    month6: { subs: number; views: number; revenue: number };
    year1: { subs: number; views: number; revenue: number };
  }> {
    const rpmMap: Record<string, number> = {
      'AI': 8.5, 'Finance': 15.5, 'Education': 8.9, 'Tech': 6.2,
      'Business': 12.8, 'Entertainment': 3.6, 'Gaming': 2.8, 'News': 6.5,
    };
    const nicheKey = Object.keys(rpmMap).find(k => niche.toLowerCase().includes(k.toLowerCase()));
    const rpm = nicheKey ? rpmMap[nicheKey] : 5.0;
    const langMultiplier = language === 'bangla' ? 0.4 : 1.0;

    return {
      month1: { subs: 500, views: 50000, revenue: Math.round(50 * rpm * langMultiplier) },
      month3: { subs: 3000, views: 300000, revenue: Math.round(300 * rpm * langMultiplier) },
      month6: { subs: 10000, views: 1500000, revenue: Math.round(1500 * rpm * langMultiplier) },
      year1: { subs: 50000, views: 10000000, revenue: Math.round(10000 * rpm * langMultiplier) },
    };
  }
}