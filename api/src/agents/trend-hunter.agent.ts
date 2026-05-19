import { getYouTubeTrends, getGoogleTrends, getRedditTrends, type TrendResult } from '../services/trend.service';
import { generateWithAI } from '../services/ai.service';
import { prisma } from '../config/db';
import { aiLogger } from '../utils/logger';
import { extractJson } from '../utils/parse-ai-response';

export interface ViralSignal {
  keyword: string;
  source: string;
  velocity: number;
  searchVolume: number;
  saturation: number;
  viralScore: number;
  monetizationPotential: number;
  niche: string;
  platform: string;
  timestamp: Date;
}

export class TrendHunterAgent {
  async scanAllSources(): Promise<ViralSignal[]> {
    aiLogger.info('TrendHunterAgent: scanning all sources for viral signals');

    const [youtube, reddit, google] = await Promise.all([
      this.scanYouTube(),
      this.scanReddit(),
      this.scanGoogleTrends(),
    ]);

    const allSignals = [...youtube, ...reddit, ...google];
    const ranked = this.dedupAndRank(allSignals);

    for (const signal of ranked.slice(0, 10)) {
      await prisma.viralOpportunity.upsert({
        where: { topic: signal.keyword },
        update: {
          viralScore: signal.viralScore,
          saturationScore: 100 - signal.velocity,
          monetizationScore: signal.monetizationPotential,
          competitionLevel: signal.saturation,
          growthVelocity: signal.velocity > 70 ? 'explosive' : signal.velocity > 50 ? 'fast' : 'steady',
          emerging: signal.velocity > 60,
          lowCompetition: signal.saturation < 30,
          source: `trend-hunter:${signal.platform}`,
          metadata: { platform: signal.platform, velocity: signal.velocity, detectedAt: new Date().toISOString() },
          analyzedAt: new Date(),
        },
        create: {
          topic: signal.keyword,
          niche: signal.niche,
          viralScore: signal.viralScore,
          saturationScore: 100 - signal.velocity,
          monetizationScore: signal.monetizationPotential,
          retentionProbability: Math.min(100, signal.viralScore),
          ctrProbability: Math.min(100, signal.searchVolume > 50 ? 70 : 40),
          competitionLevel: signal.saturation,
          audienceSize: signal.searchVolume > 70 ? 'massive' : signal.searchVolume > 40 ? 'large' : 'medium',
          growthVelocity: signal.velocity > 70 ? 'explosive' : signal.velocity > 50 ? 'fast' : 'steady',
          emerging: signal.velocity > 60,
          lowCompetition: signal.saturation < 30,
          source: `trend-hunter:${signal.platform}`,
          metadata: { platform: signal.platform, velocity: signal.velocity, detectedAt: new Date().toISOString() },
        },
      });
    }

    return ranked;
  }

  private async scanYouTube(): Promise<ViralSignal[]> {
    try {
      const raw = await getYouTubeTrends();
      const signals: ViralSignal[] = [];
      for (const title of raw.slice(0, 8)) {
        const analysis = await this.scoreTopic(title, 'youtube');
        signals.push(analysis);
      }
      return signals;
    } catch {
      return [];
    }
  }

  private async scanReddit(): Promise<ViralSignal[]> {
    try {
      const subreddits = ['videos', 'technology', 'entrepreneur', 'SmallYTChannel', 'NewTubers'];
      const results = await Promise.allSettled(subreddits.map(s => getRedditTrends(s)));
      const signals: ViralSignal[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          for (const item of result.value.slice(0, 3)) {
            const analysis = await this.scoreTopic(item.title, 'reddit');
            signals.push(analysis);
          }
        }
      }
      return signals;
    } catch {
      return [];
    }
  }

  private async scanGoogleTrends(): Promise<ViralSignal[]> {
    try {
      const niches = ['AI tools', 'side hustle', 'YouTube growth', 'faceless channel', 'make money online'];
      const results = await Promise.allSettled(niches.map(n => getGoogleTrends(n)));
      const signals: ViralSignal[] = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          for (const item of result.value.slice(0, 2)) {
            const analysis = await this.scoreTopic(item.title, 'google-trends');
            signals.push(analysis);
          }
        }
      }
      return signals;
    } catch {
      return [];
    }
  }

  private async scoreTopic(keyword: string, platform: string): Promise<ViralSignal> {
    try {
      const result = await generateWithAI(`
        Score this YouTube topic for viral potential:
        "${keyword}"
        Source: ${platform}

        Return JSON:
        {
          "niche": "best niche for this topic",
          "velocity": 0-100 (how fast it's growing),
          "searchVolume": 0-100 (relative search demand),
          "saturation": 0-100 (how saturated with content),
          "viralScore": 0-100,
          "monetizationPotential": 0-100 (CPM/ad potential)
        }

        Be realistic. Return ONLY valid JSON.
      `, 'ollama', { temperature: 0.3 });

      const parsed = extractJson(result) as any;

      return {
        keyword,
        source: platform,
        platform,
        velocity: Math.min(100, Math.max(0, parsed.velocity || 50)),
        searchVolume: Math.min(100, Math.max(0, parsed.searchVolume || 50)),
        saturation: Math.min(100, Math.max(0, parsed.saturation || 50)),
        viralScore: Math.min(100, Math.max(0, parsed.viralScore || 50)),
        monetizationPotential: Math.min(100, Math.max(0, parsed.monetizationPotential || 30)),
        niche: parsed.niche || 'General',
        timestamp: new Date(),
      };
    } catch (err) {
      aiLogger.warn(`TrendHunter: AI scoring failed for "${keyword.slice(0, 50)}"`, { error: (err as Error).message, platform });
      return {
        keyword, source: platform, platform,
        velocity: 30, searchVolume: 30, saturation: 30,
        viralScore: 25, monetizationPotential: 15,
        niche: 'General', timestamp: new Date(),
      };
    }
  }

  private dedupAndRank(signals: ViralSignal[]): ViralSignal[] {
    const seen = new Map<string, ViralSignal>();
    for (const s of signals) {
      const key = s.keyword.toLowerCase().trim();
      if (!seen.has(key) || s.viralScore > seen.get(key)!.viralScore) {
        seen.set(key, s);
      }
    }
    return Array.from(seen.values()).sort((a, b) => b.viralScore - a.viralScore);
  }
}