import { generateWithAI } from '../services/ai.service';
import { prisma } from '../config/db';
import { aiLogger } from '../utils/logger';
import { extractJson } from '../utils/parse-ai-response';

export interface ScoredOpportunity {
  topic: string;
  niche: string;
  overallScore: number;
  ctrProbability: number;
  retentionProbability: number;
  monetizationScore: number;
  competitionLevel: number;
  searchDemand: number;
  emotionalIntensity: number;
  viralLifespan: 'days' | 'weeks' | 'months' | 'evergreen';
  audienceEmotion: string;
  hookTemplate: string;
  contentFormat: 'Shorts' | 'Longform' | 'Both';
  bangladeshScore: number;
  globalScore: number;
  reasoning: string;
}

export class ViralAnalyzerAgent {
  async analyzeAndRank(topics: string[]): Promise<ScoredOpportunity[]> {
    aiLogger.info(`ViralAnalyzerAgent: analyzing ${topics.length} opportunities`);

    const scored: ScoredOpportunity[] = [];

    for (const topic of topics) {
      const result = await this.scoreOpportunity(topic);
      if (result && result.overallScore > 30) {
        scored.push(result);
      }
    }

    return scored.sort((a, b) => b.overallScore - a.overallScore);
  }

  private async scoreOpportunity(topic: string): Promise<ScoredOpportunity | null> {
    try {
      const analysis = await generateWithAI(`
        Perform deep viral potential analysis for this YouTube topic:

        Topic: "${topic}"

        Return JSON with EXACT fields:
        {
          "niche": "primary niche category",
          "ctrProbability": 0-100,
          "retentionProbability": 0-100,
          "monetizationScore": 0-100 (CPM + affiliate + product potential),
          "competitionLevel": 0-100,
          "searchDemand": 0-100,
          "emotionalIntensity": 0-100,
          "viralLifespan": "days" | "weeks" | "months" | "evergreen",
          "audienceEmotion": "curiosity" | "shock" | "fear" | "greed" | "inspiration" | "anger" | "awe",
          "hookTemplate": "best hook formula for this topic",
          "contentFormat": "Shorts" | "Longform" | "Both",
          "bangladeshScore": 0-100 (relevance to Bangla audience),
          "globalScore": 0-100 (relevance to global audience),
          "reasoning": "2-3 sentence strategic analysis"
        }

        Scoring rules:
        - CTR probability: higher for topics with natural curiosity gaps
        - Retention: higher for emotional/story-driven topics
        - Monetization: finance/tech/business > entertainment > gaming
        - Competition: check how many big channels cover this
        - Viral lifespan: evergreen > months > weeks > days
        - Emotional intensity: shock/anger/awe > curiosity > inspiration
        - Bangladesh score: higher for locally relevant topics (freelancing, AI tools in Bangla, local tech news)
        - Global score: higher for universally appealing topics

        Return ONLY valid JSON.
      `, 'ollama', { temperature: 0.3 });

      const parsed = extractJson(analysis) as any;

      const ctrProb = Math.min(100, Math.max(0, parsed.ctrProbability || 50));
      const retProb = Math.min(100, Math.max(0, parsed.retentionProbability || 50));
      const monScore = Math.min(100, Math.max(0, parsed.monetizationScore || 30));
      const compLevel = Math.min(100, Math.max(0, parsed.competitionLevel || 50));
      const demand = Math.min(100, Math.max(0, parsed.searchDemand || 50));
      const emotion = Math.min(100, Math.max(0, parsed.emotionalIntensity || 50));
      const bdScore = Math.min(100, Math.max(0, parsed.bangladeshScore || 30));
      const globalScore = Math.min(100, Math.max(0, parsed.globalScore || 50));

      const overallScore = Math.round(
        (demand * 0.20) +
        (ctrProb * 0.15) +
        (retProb * 0.20) +
        (monScore * 0.20) +
        (emotion * 0.15) +
        ((100 - compLevel) * 0.10)
      );

      return {
        topic,
        niche: parsed.niche || 'General',
        overallScore,
        ctrProbability: ctrProb,
        retentionProbability: retProb,
        monetizationScore: monScore,
        competitionLevel: compLevel,
        searchDemand: demand,
        emotionalIntensity: emotion,
        viralLifespan: parsed.viralLifespan || 'weeks',
        audienceEmotion: parsed.audienceEmotion || 'curiosity',
        hookTemplate: parsed.hookTemplate || 'Curiosity gap opener',
        contentFormat: parsed.contentFormat || 'Both',
        bangladeshScore: bdScore,
        globalScore,
        reasoning: parsed.reasoning || 'Topic shows viral potential across multiple dimensions',
      };
    } catch {
      aiLogger.warn(`ViralAnalyzerAgent: failed to score topic: ${topic}`);
      return null;
    }
  }

  async getTopNicheRecommendations(): Promise<{
    top10: ScoredOpportunity[];
    top5Faceless: ScoredOpportunity[];
    top5AIAutomatable: ScoredOpportunity[];
    top5FastestMonetization: ScoredOpportunity[];
  }> {
    const existing = await prisma.viralOpportunity.findMany({
      orderBy: { viralScore: 'desc' },
      take: 30,
    });

    const topics = existing.map(e => e.topic);
    if (topics.length < 10) {
      const defaults = [
        'AI tools for beginners', 'Faceless YouTube automation', 'Side hustle ideas 2026',
        'Make money with AI', 'Best AI productivity tools', 'YouTube automation tutorial',
        'ChatGPT secrets and tips', 'AI video generator tutorial', 'Passive income with AI',
        'AI news this week', 'How to start a faceless channel', 'Top 10 AI tools for business',
        'AI in Bangladesh', 'Freelancing with AI', 'AI content creation workflow',
      ];
      topics.push(...defaults);
    }

    const scored = await this.analyzeAndRank(topics.slice(0, 20));

    return {
      top10: scored.slice(0, 10),
      top5Faceless: scored.filter(s => s.monetizationScore > 50 && s.competitionLevel < 60).slice(0, 5),
      top5AIAutomatable: scored.filter(s => s.niche.toLowerCase().includes('ai') || s.niche.toLowerCase().includes('tech')).slice(0, 5),
      top5FastestMonetization: scored.sort((a, b) => b.monetizationScore - a.monetizationScore).slice(0, 5),
    };
  }
}