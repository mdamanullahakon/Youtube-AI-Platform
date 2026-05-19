import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { TrendHunterAgent, type ViralSignal } from '../agents/trend-hunter.agent';
import { ViralAnalyzerAgent, type ScoredOpportunity } from '../agents/viral-analyzer.agent';
import { ScriptWriterAgent, type ViralScript } from '../agents/script-writer.agent';
import { generateWithAI } from './ai.service';
import { extractJson, extractJsonArray } from '../utils/parse-ai-response';

export interface GodmodeState {
  channelId?: string;
  userId?: string;
  niche: string;
  language: 'bangla' | 'english' | 'both';
  status: 'idle' | 'scanning' | 'analyzing' | 'generating' | 'scheduling' | 'active';
  lastScanAt?: Date;
  totalIdeasGenerated: number;
  totalScriptsGenerated: number;
  activeStrategies: string[];
}

export interface GodmodeExecutionPlan {
  niche: string;
  opportunities: ScoredOpportunity[];
  rankedIdeas: VideoIdeaPlan[];
  launchRoadmap: VideoPlan[];
  monetizationStrategy: MonetizationPlan;
  bangladeshStrategy?: MarketStrategy;
  globalStrategy?: MarketStrategy;
}

export interface VideoIdeaPlan {
  title: string;
  topic: string;
  format: 'Shorts' | 'Longform';
  emotionalAngle: string;
  hookSuggestion: string;
  score: number;
  niche: string;
}

export interface VideoPlan {
  day: number;
  phase: string;
  title: string;
  hook: string;
  type: 'Shorts' | 'Longform';
  emotionalTarget: string;
  estimatedCTR: number;
  retentionPrediction: number;
  monetizationPotential: number;
  thumbnailIdea: string;
}

export interface MonetizationPlan {
  fastTrack: string[];
  first100: RevenueTarget[];
  first1000: RevenueTarget[];
  affiliateIntegrations: { product: string; commission: string; integration: string }[];
  digitalProductIdeas: string[];
  sponsorshipStrategy: string[];
}

export interface RevenueTarget {
  source: string;
  amount: string;
  timeline: string;
  effort: 'low' | 'medium' | 'high';
}

export interface MarketStrategy {
  language: string;
  contentFocus: string[];
  uploadSchedule: { time: string; timezone: string; days: string[] };
  thumbnailStyle: string;
  topVideoIdeas: string[];
  growthHacks: string[];
}

export class GodmodeOrchestrator {
  private trendHunter = new TrendHunterAgent();
  private viralAnalyzer = new ViralAnalyzerAgent();
  private scriptWriter = new ScriptWriterAgent();

  async initialize(niche: string, language: 'bangla' | 'english' | 'both', userId?: string): Promise<GodmodeState> {
    logger.info(`GodmodeOrchestrator: initializing for niche="${niche}" lang="${language}"`);

    const strategies = await prisma.contentStrategy.findMany({ where: { niche }, take: 5 });
    const ideaCount = await prisma.videoIdea.count({ where: { niche } });
    const scriptCount = await prisma.script.count();

    return {
      niche,
      language,
      status: 'idle',
      totalIdeasGenerated: ideaCount,
      totalScriptsGenerated: scriptCount,
      activeStrategies: strategies.map(s => s.hookStyle),
      userId,
    };
  }

  async fullScanAndAnalyze(): Promise<ViralSignal[]> {
    logger.info('GodmodeOrchestrator: running full scan and analyze cycle');
    const signals = await this.trendHunter.scanAllSources();
    return signals;
  }

  async analyzeOpportunities(topics: string[]): Promise<ScoredOpportunity[]> {
    logger.info(`GodmodeOrchestrator: analyzing ${topics.length} opportunities`);
    return this.viralAnalyzer.analyzeAndRank(topics);
  }

  async getNicheRecommendations(): Promise<{
    top10: ScoredOpportunity[];
    top5Faceless: ScoredOpportunity[];
    top5AIAutomatable: ScoredOpportunity[];
    top5FastestMonetization: ScoredOpportunity[];
  }> {
    return this.viralAnalyzer.getTopNicheRecommendations();
  }

  async generateVideoIdea(topic: string, niche: string, format: 'Shorts' | 'Longform' = 'Shorts'): Promise<VideoIdeaPlan> {
    const result = await generateWithAI(`
      Create a high-potential YouTube video idea for niche: "${niche}"

      Topic base: "${topic}"
      Format: ${format}

      Return JSON:
      {
        "title": "viral-optimized title under 60 chars",
        "emotionalAngle": "curiosity | shock | fear | greed | inspiration | awe",
        "hookSuggestion": "one sentence hook that would make anyone stop scrolling",
        "score": 0-100 (overall viral potential)
      }

      Think like a YouTube algorithm engineer. Maximize CTR + retention.
      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.5 });

    try {
      const parsed = extractJson(result) as any;
      return {
        title: parsed.title || topic,
        topic,
        format,
        emotionalAngle: parsed.emotionalAngle || 'curiosity',
        hookSuggestion: parsed.hookSuggestion || '',
        score: Math.min(100, Math.max(0, parsed.score || 50)),
        niche,
      };
    } catch {
      return { title: topic, topic, format, emotionalAngle: 'curiosity', hookSuggestion: '', score: 50, niche };
    }
  }

  async saveVideoIdea(idea: VideoIdeaPlan, userId?: string): Promise<void> {
    await prisma.videoIdea.create({
      data: {
        title: idea.title,
        topic: idea.topic,
        niche: idea.niche,
        format: idea.format,
        trendScore: idea.score,
        viralProbability: idea.score / 100,
        emotionalAngle: idea.emotionalAngle,
        hookSuggestion: idea.hookSuggestion,
        status: 'idea',
        source: 'godmode-orchestrator',
        userId: userId || null,
      },
    });
  }

  async generateScriptForIdea(idea: VideoIdeaPlan): Promise<ViralScript> {
    logger.info(`GodmodeOrchestrator: generating script for "${idea.title}"`);
    return this.scriptWriter.generateViralScript(
      idea.topic,
      idea.format,
      idea.niche,
      idea.emotionalAngle,
      idea.hookSuggestion,
    );
  }

  async generate30VideoRoadmap(
    niche: string,
    language: 'bangla' | 'english' | 'both' = 'english',
    format: 'Shorts' | 'Longform' | 'mixed' = 'mixed',
  ): Promise<{
    roadmap: VideoPlan[];
    monetizationPlan: MonetizationPlan;
    bangladeshStrategy?: MarketStrategy;
    globalStrategy?: MarketStrategy;
  }> {
    logger.info(`GodmodeOrchestrator: generating 30-video roadmap for "${niche}"`);

    const ideas: VideoIdeaPlan[] = [];
    const topics = await this.generateTopicIdeas(niche, 15);

    for (let i = 0; i < 15; i++) {
      const f: 'Shorts' | 'Longform' = format === 'mixed'
        ? (i < 10 ? 'Shorts' : 'Longform')
        : format;
      const idea = await this.generateVideoIdea(topics[i % topics.length], niche, f);
      ideas.push(idea);
    }

    const roadmap: VideoPlan[] = [];
    for (let day = 1; day <= 30; day++) {
      const phase = day <= 10 ? 'Testing' : day <= 20 ? 'Optimization' : 'Scaling';
      const ideaIndex = (day - 1) % ideas.length;
      const idea = ideas[ideaIndex];
      const vidType: 'Shorts' | 'Longform' = format === 'mixed'
        ? (day <= 21 ? 'Shorts' : 'Longform')
        : format;

      const plan = await this.scriptWriter.generateViralScript(idea.topic, vidType, niche, idea.emotionalAngle, idea.hookSuggestion);

      roadmap.push({
        day,
        phase,
        title: plan.title || idea.title,
        hook: plan.hook,
        type: vidType,
        emotionalTarget: idea.emotionalAngle,
        estimatedCTR: vidType === 'Shorts' ? 15 + Math.round(Math.random() * 10) : 8 + Math.round(Math.random() * 8),
        retentionPrediction: vidType === 'Shorts' ? 60 + Math.round(Math.random() * 25) : 35 + Math.round(Math.random() * 25),
        monetizationPotential: Math.round(30 + Math.random() * 60),
        thumbnailIdea: `${idea.emotionalAngle} expression, bold text: "${this.extractThumbnailText(plan.title || idea.title)}", high contrast colors`,
      });
    }

    const monetizationPlan = await this.generateMonetizationPlan(niche);
    const marketStrategies = await this.generateMarketStrategies(niche, language);

    return {
      roadmap,
      monetizationPlan,
      ...marketStrategies,
    };
  }

  private async generateTopicIdeas(niche: string, count: number): Promise<string[]> {
    const result = await generateWithAI(`
      Generate ${count} specific, high-potential YouTube video topics for the niche: "${niche}"

      Each topic MUST be:
      - Specific (not generic)
      - Have curiosity gap potential
      - Could work as faceless content
      - Monetizable (affiliate, ad, or product potential)

      Return JSON array of strings.
      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.6 });

    try {
      const parsed = extractJsonArray<string>(result);
      return parsed ? parsed.slice(0, count) : [];
    } catch {
      const defaults = [];
      for (let i = 0; i < count; i++) {
        defaults.push(`${niche} strategy ${i + 1}: the ultimate guide`);
      }
      return defaults;
    }
  }

  private async generateMonetizationPlan(niche: string): Promise<MonetizationPlan> {
    const result = await generateWithAI(`
      Create a detailed monetization plan for a YouTube channel in niche: "${niche}"

      Return JSON:
      {
        "fastTrack": ["3 strategies to reach 1000 subs fast"],
        "first100": [{"source": "revenue source", "amount": "estimated $", "timeline": "timeframe", "effort": "low|medium|high"}],
        "first1000": [{"source": "revenue source", "amount": "estimated $", "timeline": "timeframe", "effort": "low|medium|high"}],
        "affiliateIntegrations": [{"product": "product name", "commission": "commission structure", "integration": "how to promote"}],
        "digitalProductIdeas": ["3 digital product ideas"],
        "sponsorshipStrategy": ["3 strategies to attract sponsors"]
      }

      Be realistic with amounts. Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.4 });

    try {
      const parsed = extractJson(result) as any;
      if (!parsed) throw new Error();
      return parsed;
    } catch {
      return {
        fastTrack: ['Post daily Shorts for 60 days', 'Focus on 1 viral-friendly sub-niche', 'Collaborate with similar channels'],
        first100: [
          { source: 'YouTube AdSense', amount: '$30-50', timeline: 'Month 2-3', effort: 'medium' },
          { source: 'Affiliate Marketing', amount: '$40-80', timeline: 'Month 1-3', effort: 'low' },
        ],
        first1000: [
          { source: 'YouTube AdSense', amount: '$200-400', timeline: 'Month 4-6', effort: 'medium' },
          { source: 'Affiliate Marketing', amount: '$300-600', timeline: 'Month 3-6', effort: 'low' },
          { source: 'Digital Products', amount: '$100-300', timeline: 'Month 4-6', effort: 'high' },
        ],
        affiliateIntegrations: [
          { product: 'Amazon products', commission: '1-10%', integration: 'Link in description + tutorial mentions' },
        ],
        digitalProductIdeas: ['Template pack', 'PDF guide', 'Exclusive community'],
        sponsorshipStrategy: ['Reach out at 1K subs with media kit', 'Offer free value first', 'Join sponsor marketplaces'],
      };
    }
  }

  private async generateMarketStrategies(niche: string, language: string): Promise<{
    bangladeshStrategy?: MarketStrategy;
    globalStrategy?: MarketStrategy;
  }> {
    const result: any = {};

    if (language === 'bangla' || language === 'both') {
      result.bangladeshStrategy = {
        language: 'Bangla',
        contentFocus: [
          `${niche} in Bangla — local context`,
          `Freelancing and ${niche} for Bangladeshi audience`,
          `${niche} tools available in Bangladesh`,
        ],
        uploadSchedule: { time: '09:00', timezone: 'Asia/Dhaka', days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'] },
        thumbnailStyle: 'Bangla text overlay, warm colors, local imagery',
        topVideoIdeas: [
          `${niche} দিয়ে Freelancing শুরু করুন`,
          `${niche} Bangla Tutorial (পুরো কোর্স)`,
        ],
        growthHacks: ['Cross-post to Facebook groups', 'Use Bangla keywords in title + description', 'Mobile-optimized thumbnails'],
      };
    }

    if (language === 'english' || language === 'both') {
      result.globalStrategy = {
        language: 'English',
        contentFocus: [
          `${niche} for global audience — evergreen value`,
          `${niche} tools and platforms worldwide`,
          `Case studies and success stories in ${niche}`,
        ],
        uploadSchedule: { time: '10:00', timezone: 'America/New_York', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] },
        thumbnailStyle: 'Face closeup (AI avatar), bold sans-serif text, high contrast (red/blue/yellow)',
        topVideoIdeas: [
          `The Ultimate ${niche} Guide for 2026`,
          `Top 10 ${niche} Tools You Need to Know`,
        ],
        growthHacks: ['Focus on searchable evergreen titles', 'Community posts for engagement', 'End screen cross-promotion'],
      };
    }

    return result;
  }

  private extractThumbnailText(title: string): string {
    const words = title.split(' ');
    return words.slice(0, 4).join(' ');
  }

  async getFullExecutionPlan(niche: string, language: 'bangla' | 'english' | 'both' = 'english'): Promise<GodmodeExecutionPlan> {
    const signals = await this.fullScanAndAnalyze();
    const topics = signals.map(s => s.keyword).filter(Boolean);
    const opportunities = await this.analyzeOpportunities(topics.length > 0 ? topics : [niche]);
    const ideaTopics = await this.generateTopicIdeas(niche, 5);

    const rankedIdeas: VideoIdeaPlan[] = [];
    for (let i = 0; i < 5; i++) {
      const idea = await this.generateVideoIdea(ideaTopics[i] || niche, niche);
      rankedIdeas.push(idea);
    }

    const roadmapResult = await this.generate30VideoRoadmap(niche, language);

    return {
      niche,
      opportunities,
      rankedIdeas,
      launchRoadmap: roadmapResult.roadmap,
      monetizationStrategy: roadmapResult.monetizationPlan,
      bangladeshStrategy: roadmapResult.bangladeshStrategy,
      globalStrategy: roadmapResult.globalStrategy,
    };
  }
}