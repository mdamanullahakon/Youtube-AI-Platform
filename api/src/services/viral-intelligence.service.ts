import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import type {
  ViralIntelligenceReport,
  TopicCategory,
  CtrSubScore,
  RetentionSubScore,
  MonetizationSubScore,
  SaturationSubScore,
  TopicSubScore,
  ViralWeights,
} from './viral-intelligence.types';

const DEFAULT_WEIGHTS: ViralWeights = {
  ctrWeight: 0.30,
  retentionWeight: 0.30,
  monetizationWeight: 0.20,
  trendWeight: 0.20,
  saturationPenalty: 0.25,
};

const POWER_WORDS = new Set([
  'secret', 'hidden', 'revealed', 'exposed', 'truth', 'shock', 'shocking',
  'genius', 'brilliant', 'insane', 'crazy', 'mind-blowing', 'unbelievable',
  'incredible', 'never', 'always', 'everyone', 'nobody', 'guaranteed',
  'proven', 'scientific', 'research', 'study', 'experts', 'doctors',
  'million', 'billion', 'thousands', 'millions', 'free', 'best', 'worst',
  'ultimate', 'essential', 'critical', 'dangerous', 'deadly', 'life-changing',
  'transform', 'destroy', 'eliminate', 'breakthrough', 'revolutionary',
  'simple', 'easy', 'fast', 'instant', 'powerful', 'effective', 'legit',
  'warning', 'urgent', 'last chance', 'limited', 'exclusive',
]);

const NICHE_RPM_MAP: Record<TopicCategory, { min: number; max: number }> = {
  finance: { min: 8, max: 30 },
  ai: { min: 6, max: 25 },
  business: { min: 5, max: 20 },
  tech: { min: 4, max: 15 },
  education: { min: 3, max: 12 },
  'self-improvement': { min: 3, max: 10 },
  health: { min: 3, max: 12 },
  science: { min: 2, max: 8 },
  entertainment: { min: 1, max: 5 },
  lifestyle: { min: 1, max: 6 },
  gaming: { min: 0.5, max: 3 },
  other: { min: 1, max: 5 },
};

export class ViralIntelligenceService {
  private weights: ViralWeights = { ...DEFAULT_WEIGHTS };

  constructor() {
    this.loadWeights().catch(() => {});
  }

  // ────────────────────────────────────────────────────────
  //  PUBLIC API
  // ────────────────────────────────────────────────────────

  async analyzeTopic(topic: string, projectId?: string): Promise<ViralIntelligenceReport> {
    logger.info(`[ViralIntelligence] Analyzing topic: "${topic}"`);

    const category = this.classifyTopic(topic);
    const topicScore = await this.analyzeTopicMetrics(topic, category);
    const ctrScore = this.predictCTR(topic, topicScore);
    const retentionScore = this.predictRetention(topic, topicScore);
    const monetizationScore = this.predictRPM(topic, category);
    const saturationScore = await this.detectSaturation(topic, category);
    const viralScore = this.calculateViralScore(
      ctrScore.score,
      retentionScore.score,
      monetizationScore.score,
      topicScore.trend,
      saturationScore.score,
    );

    const decision = this.makeDecision(viralScore, ctrScore.score, retentionScore.score, saturationScore.score);
    const improvementSuggestions = this.generateSuggestions(
      decision, viralScore, ctrScore, retentionScore, monetizationScore, saturationScore, topicScore, topic,
    );

    const report: ViralIntelligenceReport = {
      topic,
      category,
      trendScore: topicScore.trend,
      competitionLevel: topicScore.competition >= 70 ? 'high' : topicScore.competition >= 40 ? 'medium' : 'low',
      searchDemand: topicScore.searchDemand,
      noveltyScore: topicScore.novelty,
      ctrScore: ctrScore.score,
      retentionScore: retentionScore.score,
      monetizationScore: monetizationScore.score,
      saturationScore: saturationScore.score,
      viralScore,
      decision,
      improvementSuggestions,
      subScores: { ctr: ctrScore, retention: retentionScore, monetization: monetizationScore, saturation: saturationScore, topic: topicScore },
    };

    // Persist prediction log
    report.predictionId = await this.savePredictionLog(report, projectId);

    // Update ViralOpportunity table
    await this.upsertViralOpportunity(topic, category, report);

    logger.info(`[ViralIntelligence] ${topic} → viralScore=${viralScore.toFixed(1)} → ${decision}`);
    return report;
  }

  async runSelfLearning(projectId: string): Promise<void> {
    try {
      const project = await prisma.videoProject.findUnique({
        where: { id: projectId },
        include: { analytics: true, contentPerformance: true, uploadHistory: true },
      });
      if (!project || !project.analytics || !project.contentPerformance) {
        logger.warn(`[SelfLearning] Missing analytics or performance data for ${projectId}`);
        return;
      }

      const predictionLog = await prisma.viralPredictionLog.findFirst({
        where: { projectId, topic: project.topic },
        orderBy: { createdAt: 'desc' },
      });
      if (!predictionLog) {
        logger.warn(`[SelfLearning] No prediction log found for ${projectId}`);
        return;
      }

      const actualCTR = project.contentPerformance.actualCTR;
      const actualRetention = project.contentPerformance.actualRetention;
      const actualViews = project.contentPerformance.actualViews;

      // Convert to 0-100 scale for comparison
      const actualCTRScore = Math.min(100, Math.max(0, actualCTR * 10));
      const actualRetentionScore = Math.min(100, Math.max(0, actualRetention));

      // Compute errors
      const ctrError = predictionLog.ctrScore - actualCTRScore;
      const retentionError = predictionLog.retentionScore - actualRetentionScore;

      // Update prediction log with actuals
      await prisma.viralPredictionLog.update({
        where: { id: predictionLog.id },
        data: {
          actualViews,
          actualCTR,
          actualRetention: actualRetention,
          ctrError,
          retentionError,
          viralScoreError: predictionLog.viralScore - this.computeViralScoreFromActuals(actualCTRScore, actualRetentionScore, predictionLog),
        },
      });

      // Update ContentPerformance with gap analysis
      await prisma.contentPerformance.update({
        where: { projectId },
        data: {
          predictedHookScore: predictionLog.ctrScore,
          predictedThumbnailCTR: predictionLog.ctrScore / 10,
          predictedRetention: predictionLog.retentionScore,
          predictedEngagement: (predictionLog.ctrScore + predictionLog.retentionScore) / 2,
          hookGap: ctrError,
          retentionGap: retentionError,
        },
      });

      // Adjust weights based on prediction error
      await this.adjustWeights(ctrError, retentionError);

      // Store winning patterns if performance was good
      if (actualCTRScore >= 60 || actualRetentionScore >= 60) {
        await this.storeWinningPatterns(project, predictionLog);
      }

      logger.info(`[SelfLearning] Completed for ${projectId}: CTR error=${ctrError.toFixed(1)}pts, retention error=${retentionError.toFixed(1)}pts`);
    } catch (err: any) {
      logger.error(`[SelfLearning] Failed for ${projectId}: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────
  //  1. TOPIC ANALYZER
  // ────────────────────────────────────────────────────────

  private classifyTopic(topic: string): TopicCategory {
    const lower = topic.toLowerCase();
    if (/\b(ai|artificial intelligence|machine learning|deep learning|llm|chatgpt|gpt|neural)\b/.test(lower)) return 'ai';
    if (/\b(money|finance|invest|stock|crypto|bitcoin|trading|real estate|passive income|financial|wealth|retire|economy)\b/.test(lower)) return 'finance';
    if (/\b(tech|software|app|startup|programming|coding|developer|saas|cloud|cybersecurity)\b/.test(lower)) return 'tech';
    if (/\b(health|fitness|workout|diet|nutrition|weight loss|exercise|medicine|disease|symptom)\b/.test(lower)) return 'health';
    if (/\b(educat|learn|course|skill|study|tutorial|guide|how to|lesson|class)\b/.test(lower)) return 'education';
    if (/\b(game|gaming|minecraft|fortnite|roblox|valorant|stream)\b/.test(lower)) return 'gaming';
    if (/\b(business|entrepreneur|marketing|sales|startup|b2b|ecommerce|agency)\b/.test(lower)) return 'business';
    if (/\b(science|physics|chemistry|biology|space|planet|universe|research)\b/.test(lower)) return 'science';
    if (/\b(self[- ]improve|productivity|habit|mindset|motivation|success|goal)\b/.test(lower)) return 'self-improvement';
    if (/\b(entertain|movie|show|celebrity|drama|tv|music)\b/.test(lower)) return 'entertainment';
    if (/\b(lifestyle|travel|food|cooking|recipe|fashion|beauty|home|family)\b/.test(lower)) return 'lifestyle';
    return 'other';
  }

  private async analyzeTopicMetrics(topic: string, category: TopicCategory): Promise<TopicSubScore> {
    // Trend score based on AI analysis + keyword freshness
    const trend = await this.computeTrendScore(topic, category);

    // Competition level from database + AI
    const competition = await this.computeCompetitionLevel(topic);

    // Search demand estimate
    const searchDemand = await this.computeSearchDemand(topic, category);

    // Novelty score — how fresh the idea is vs. existing content
    const novelty = await this.computeNoveltyScore(topic, category);

    const score = Math.max(0, Math.min(100,
      trend * 0.30 + (100 - competition) * 0.25 + searchDemand * 0.25 + novelty * 0.20
    ));

    return { score, trend, competition, searchDemand, novelty };
  }

  private async computeTrendScore(topic: string, category: TopicCategory): Promise<number> {
    try {
      // Check ViralOpportunity DB first
      const existing = await prisma.viralOpportunity.findUnique({ where: { topic } });
      if (existing && existing.viralScore > 0) {
        return Math.min(100, Math.max(0, existing.viralScore + (existing.emerging ? 15 : 0) - (existing.lowCompetition ? -5 : 0)));
      }

      // AI-enhanced trend analysis
      const prompt = `Rate the trend potential of this video topic from 0-100 (only return the number):
Topic: "${topic}"
Category: ${category}
Consider: current Google Trends, YouTube search growth, social media buzz, seasonal relevance.`;
      const aiResult = await generateWithAI(prompt, 'ollama', { temperature: 0.3, timeout: 30000 });
      const parsed = parseInt(aiResult.trim(), 10);
      return !isNaN(parsed) ? Math.min(100, Math.max(0, parsed)) : 50;
    } catch {
      return 50;
    }
  }

  private async computeCompetitionLevel(topic: string): Promise<number> {
    try {
      // Count recent similar topics in DB
      const [recentProjects, recentOpportunities] = await Promise.all([
        prisma.videoProject.count({
          where: { topic: { contains: topic.substring(0, 20) }, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } },
        }),
        prisma.viralOpportunity.count({
          where: { topic: { contains: topic.substring(0, 20) }, analyzedAt: { gte: new Date(Date.now() - 30 * 86400000) } },
        }),
      ]);

      const dbCompetition = Math.min(100, (recentProjects + recentOpportunities) * 10);

      const prompt = `Rate the competition level for YouTube content about "${topic}" from 0-100 (only return the number):
0 = no competition
100 = extremely saturated
Consider: number of creators covering this, how hard to rank, ad competition.`;
      const aiResult = await generateWithAI(prompt, 'ollama', { temperature: 0.3, timeout: 30000 });
      const aiCompetition = parseInt(aiResult.trim(), 10);

      const final = !isNaN(aiCompetition) ? (dbCompetition * 0.3 + aiCompetition * 0.7) : dbCompetition;
      return Math.min(100, Math.max(0, final));
    } catch {
      return 30;
    }
  }

  private async computeSearchDemand(topic: string, category: TopicCategory): Promise<number> {
    const categoryDemandMap: Record<TopicCategory, number> = {
      ai: 85, finance: 80, tech: 70, health: 65, 'self-improvement': 60,
      business: 65, education: 55, science: 45, entertainment: 50,
      lifestyle: 40, gaming: 35, other: 30,
    };
    const baseDemand = categoryDemandMap[category] || 30;

    // Boost for specific high-demand patterns
    let boost = 0;
    const lower = topic.toLowerCase();
    if (/\b(2026|this year|new|latest|trending|viral|how to|tutorial|guide|review|vs|best|top|affordable|free)\b/.test(lower)) boost += 10;
    if (lower.includes('ai') || lower.includes('money') || lower.includes('income')) boost += 15;
    if (lower.length > 10 && lower.length < 60) boost += 5;

    return Math.min(100, baseDemand + boost);
  }

  private async computeNoveltyScore(topic: string, category: TopicCategory): Promise<number> {
    try {
      const similarTopics = await prisma.videoProject.count({
        where: { topic: { contains: topic.substring(0, 25) } },
      });
      const baseNovelty = Math.max(0, 100 - similarTopics * 15);

      const prompt = `Rate how NOVEL and FRESH this video topic idea is from 0-100 (only return the number):
Topic: "${topic}"
Category: ${category}
0 = overdone, millions of videos
100 = completely fresh, nobody covering this
Consider: unique angle, underserved subtopic, recent developments.`;
      const aiResult = await generateWithAI(prompt, 'ollama', { temperature: 0.4, timeout: 30000 });
      const aiNovelty = parseInt(aiResult.trim(), 10);

      return !isNaN(aiNovelty) ? Math.min(100, Math.max(0, baseNovelty * 0.3 + aiNovelty * 0.7)) : baseNovelty;
    } catch {
      return 50;
    }
  }

  // ────────────────────────────────────────────────────────
  //  2. CTR PREDICTION ENGINE
  // ────────────────────────────────────────────────────────

  private predictCTR(topic: string, topicScore: TopicSubScore): CtrSubScore {
    const lower = topic.toLowerCase();
    let hookStrength = 0;
    let curiosityGap = 0;
    let emotionalTrigger = 0;
    let powerWordsScore = 0;

    // Hook strength analysis
    const hookStarters = ['how to', 'why', 'what', 'the truth', 'this is', 'i tried', 'we tried', 'watch this', 'you won\'t', 'this will'];
    for (const starter of hookStarters) {
      if (lower.startsWith(starter)) hookStrength += 15;
    }

    // Curiosity gap detection
    if (/\b(why|how|what|when|who|which)\b/.test(lower)) curiosityGap += 20;
    if (lower.includes('?')) curiosityGap += 15;
    if (/(\.\.\.)|(--)|—/.test(lower)) curiosityGap += 10;
    if (/\b(this|these|the secret|nobody knows|no one|hidden)\b/.test(lower)) curiosityGap += 15;

    // Emotional trigger detection
    const emotionalWords: [string, number][] = [
      ['shock', 20], ['surprise', 15], ['fear', 20], ['angry', 15], ['outrage', 20],
      ['heartbreaking', 20], ['inspiring', 15], ['hilarious', 10], ['amazing', 10],
      ['dangerous', 20], ['terrifying', 20], ['beautiful', 10], ['tragic', 20],
      ['worry', 15], ['scared', 15], ['thrilled', 10],
    ];
    for (const [word, val] of emotionalWords) {
      if (lower.includes(word)) emotionalTrigger += val;
    }

    // Numbers boost (CTR benefit)
    if (/[0-9]/.test(lower)) emotionalTrigger += 10;

    // Power words scoring
    const words = lower.split(/\s+/);
    let powerWordCount = 0;
    for (const word of words) {
      if (POWER_WORDS.has(word)) powerWordCount++;
    }
    powerWordsScore = Math.min(100, powerWordCount * 15 + (powerWordCount >= 2 ? 10 : 0));

    // Clamp all sub-scores
    hookStrength = Math.min(100, hookStrength);
    curiosityGap = Math.min(100, curiosityGap);
    emotionalTrigger = Math.min(100, emotionalTrigger);
    powerWordsScore = Math.min(100, powerWordsScore);

    // Bonus: competition-aware CTR modifier
    const competitionPenalty = topicScore.competition > 80 ? 15 : topicScore.competition > 60 ? 8 : 0;

    const score = Math.max(0, Math.min(100,
      hookStrength * 0.30 + curiosityGap * 0.25 + emotionalTrigger * 0.25 + powerWordsScore * 0.20 - competitionPenalty
    ));

    const titleVariations = this.generateTitleVariations(topic);

    return { score, hookStrength, curiosityGap, emotionalTrigger, powerWords: powerWordsScore, titleVariations };
  }

  // ────────────────────────────────────────────────────────
  //  3. RETENTION PREDICTION ENGINE
  // ────────────────────────────────────────────────────────

  private predictRetention(topic: string, topicScore: TopicSubScore): RetentionSubScore {
    const lower = topic.toLowerCase();

    // Hook strength in first 10s
    let hookStrength = 0;
    if (/^(how to|why|what|the truth|this|i tried)/.test(lower)) hookStrength += 25;
    if (/\b(you|your|we|our)\b/.test(lower)) hookStrength += 20;
    if (lower.includes('?')) hookStrength += 15;
    if (lower.includes('!')) hookStrength += 10;
    hookStrength = Math.min(100, hookStrength + 10);

    // Pacing quality based on topic structure
    let pacing = 50;
    if (/\b(steps|ways|methods|tips|techniques|strategies|secrets|stages|phases)\b/.test(lower)) pacing += 20;
    if (/\b(guide|tutorial|walkthrough|masterclass|deep dive)\b/.test(lower)) pacing += 15;
    if (/\b(beginner|advanced|intermediate|complete|ultimate|full)\b/.test(lower)) pacing += 10;
    if (lower.length > 20 && lower.length < 80) pacing += 15;
    pacing = Math.min(100, pacing);

    // Story structure presence
    let storyStructure = 30;
    if (/\b(story|journey|experience|how i|case study|behind the scenes|history)\b/.test(lower)) storyStructure += 25;
    if (/(before.*after)|(from.*to)|(then.*now)/.test(lower)) storyStructure += 20;
    if (/\b(lesson|reveal|discovery|breakthrough|findings|result)\b/.test(lower)) storyStructure += 15;
    storyStructure = Math.min(100, storyStructure);

    // Emotional arc strength
    let emotionalArc = 30;
    if (/\b(struggle|challenge|overcome|transform|change|journey|survive|thrive|win|lose)\b/.test(lower)) emotionalArc += 25;
    if (/\b(emotional|heart|feeling|pain|suffer|joy|happy|sad)\b/.test(lower)) emotionalArc += 20;
    if (/\b(inspiring|motivat|empower|hope|dream|vision)\b/.test(lower)) emotionalArc += 15;
    emotionalArc = Math.min(100, emotionalArc);

    // Novelty boost for retention
    const noveltyBoost = topicScore.novelty > 70 ? 10 : topicScore.novelty > 50 ? 5 : 0;
    // Competition penalty
    const competitionPenalty = topicScore.competition > 80 ? 12 : topicScore.competition > 60 ? 6 : 0;

    const score = Math.max(0, Math.min(100,
      hookStrength * 0.30 + pacing * 0.25 + storyStructure * 0.25 + emotionalArc * 0.20 + noveltyBoost - competitionPenalty
    ));

    return { score, hookStrength, pacing, storyStructure, emotionalArc };
  }

  // ────────────────────────────────────────────────────────
  //  4. MONETIZATION ENGINE
  // ────────────────────────────────────────────────────────

  private predictRPM(topic: string, category: TopicCategory): MonetizationSubScore {
    const rpmRange = NICHE_RPM_MAP[category] || NICHE_RPM_MAP.other;

    // Advertiser demand per niche
    const advertiserDemandMap: Record<TopicCategory, number> = {
      finance: 95, ai: 90, business: 80, tech: 70, education: 55,
      health: 65, 'self-improvement': 50, lifestyle: 40, entertainment: 30,
      science: 35, gaming: 20, other: 25,
    };
    let advertiserDemand = advertiserDemandMap[category] || 25;

    // Niche value score
    let nicheValue = (rpmRange.min / rpmRange.max) * 100;
    const lower = topic.toLowerCase();

    // Boost for high-value subtopics
    if (/\b(money|crypto|invest|stock|trading|real estate|saas|software|affiliate|course|coach|crypto|blockchain)\b/.test(lower)) {
      nicheValue += 20;
      advertiserDemand += 10;
    }

    // Audience geo targeting potential
    let audienceGeo = 50;
    if (/\b(global|world|international|anyone|everyone|universal)\b/.test(lower)) audienceGeo += 25;
    if (/\b(usa|america|uk|europe|canada|australia)\b/.test(lower)) audienceGeo += 10;
    if (/\b(tips|guide|tutorial|beginner)\b/.test(lower)) audienceGeo += 15;

    advertiserDemand = Math.min(100, advertiserDemand);
    nicheValue = Math.min(100, nicheValue);
    audienceGeo = Math.min(100, audienceGeo);

    const estimatedRpm = rpmRange.min + (nicheValue / 100) * (rpmRange.max - rpmRange.min);

    const score = Math.max(0, Math.min(100,
      advertiserDemand * 0.35 + nicheValue * 0.40 + audienceGeo * 0.25
    ));

    return { score, advertiserDemand, nicheValue, audienceGeo, estimatedRpm };
  }

  // ────────────────────────────────────────────────────────
  //  5. SATURATION DETECTOR
  // ────────────────────────────────────────────────────────

  private async detectSaturation(topic: string, category: TopicCategory): Promise<SaturationSubScore> {
    // Keyword competition density
    let keywordCompetition = 30;
    const lower = topic.toLowerCase();
    const highCompetitionKeywords = ['how to', 'best', 'top 10', 'review', 'tutorial', 'vs', 'crypto', 'bitcoin', 'ai', 'chatgpt', 'make money', 'weight loss'];
    for (const kw of highCompetitionKeywords) {
      if (lower.includes(kw)) keywordCompetition += 10;
    }
    // Short/generic topics are more saturated
    if (lower.length < 15) keywordCompetition += 20;
    if (lower.length > 50) keywordCompetition -= 10;

    // Content redundancy risk
    let contentRedundancy = 30;
    const redundantPatterns = ['for beginners', 'explained', 'what is', 'what are', 'introduction to', 'complete guide', 'ultimate guide'];
    for (const pat of redundantPatterns) {
      if (lower.includes(pat)) contentRedundancy += 10;
    }

    // Trend saturation from DB
    let trendSaturation = 20;
    try {
      const recentCount = await prisma.videoProject.count({
        where: {
          topic: { contains: topic.substring(0, 25) },
          createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
        },
      });
      trendSaturation = Math.min(100, recentCount * 12);
    } catch {
      trendSaturation = 30;
    }

    keywordCompetition = Math.min(100, keywordCompetition);
    contentRedundancy = Math.min(100, contentRedundancy);
    trendSaturation = Math.min(100, trendSaturation);

    // AI-enhanced saturation check
    try {
      const prompt = `Rate the content saturation for "${topic}" on YouTube from 0-100 (only return the number):
0 = untouched niche, very few videos
100 = completely saturated, thousands of identical videos
Consider: how many creators cover this exact angle, how hard to differentiate.`;
      const aiResult = await generateWithAI(prompt, 'ollama', { temperature: 0.3, timeout: 30000 });
      const aiSaturation = parseInt(aiResult.trim(), 10);
      if (!isNaN(aiSaturation)) {
        keywordCompetition = keywordCompetition * 0.4 + aiSaturation * 0.6;
      }
    } catch { /* use db-based scores */ }

    const score = Math.min(100, Math.max(0,
      keywordCompetition * 0.40 + contentRedundancy * 0.30 + trendSaturation * 0.30
    ));

    return { score, keywordCompetition, contentRedundancy, trendSaturation };
  }

  // ────────────────────────────────────────────────────────
  //  6. VIRAL SCORE CALCULATION
  // ────────────────────────────────────────────────────────

  private calculateViralScore(
    ctr: number, retention: number, monetization: number, trend: number, saturation: number,
  ): number {
    const raw =
      ctr * this.weights.ctrWeight +
      retention * this.weights.retentionWeight +
      monetization * this.weights.monetizationWeight +
      trend * this.weights.trendWeight -
      saturation * this.weights.saturationPenalty;

    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  private makeDecision(
    viralScore: number, ctrScore: number, retentionScore: number, saturationScore: number,
  ): 'ALLOW' | 'REJECT' | 'REGENERATE' {
    if (saturationScore > 80) return 'REJECT';
    if (viralScore < 60) return 'REJECT';
    if (viralScore < 75) return 'REGENERATE';
    if (ctrScore < 60) return 'REGENERATE';
    if (retentionScore < 60) return 'REGENERATE';
    return 'ALLOW';
  }

  // ────────────────────────────────────────────────────────
  //  IMPROVEMENT SUGGESTIONS
  // ────────────────────────────────────────────────────────

  private generateSuggestions(
    decision: string,
    viralScore: number,
    ctr: CtrSubScore,
    retention: RetentionSubScore,
    monetization: MonetizationSubScore,
    saturation: SaturationSubScore,
    topicScore: TopicSubScore,
    topic?: string,
  ): string[] {
    const suggestions: string[] = [];

    if (decision === 'REJECT' && saturation.score > 80) {
      suggestions.push(`Topic too saturated (${saturation.score.toFixed(0)}/100). Pivot to a subtopic or niche angle with less competition.`);
    }
    if (decision === 'REJECT' || viralScore < 75) {
      if (ctr.score < 60) {
        const topicShort = topic ? this.getTopicShort(topic) : 'this';
        suggestions.push(`CTR too low (${ctr.score.toFixed(0)}/100). Add numbers, power words, or a curiosity gap to the title. Examples: "5 ${topicShort} Strategies..." or "The ${topicShort} Secret Nobody Talks About"`);
      }
      if (retention.score < 60) {
        suggestions.push(`Retention risk (${retention.score.toFixed(0)}/100). Strengthen the hook (first 10 seconds), add pattern interrupts, ensure clear story structure.`);
      }
      if (retention.hookStrength < 40) {
        suggestions.push(`Weak hook structure. Start with "How to", "Why", "The truth about", or a shocking statistic.`);
      }
      if (retention.storyStructure < 40) {
        suggestions.push(`No clear story arc. Structure the script as: Hook → Problem → Solution → CTA.`);
      }
      if (monetization.score < 50) {
        suggestions.push(`Low monetization potential (${monetization.score.toFixed(0)}/100). Consider tying the topic to finance, software, or high-ticket affiliate products.`);
      }
      if (topicScore.competition > 70) {
        suggestions.push(`High competition (${topicScore.competition.toFixed(0)}/100). Differentiate with a unique angle or niche audience focus.`);
      }
      if (topicScore.novelty < 30) {
        suggestions.push(`Low novelty score. Combine two trending topics for a fresh angle.`);
      }
    }
    if (decision === 'ALLOW' && ctr.titleVariations && ctr.titleVariations.length > 0) {
      suggestions.push(`Consider these title variations: ${ctr.titleVariations.slice(0, 2).join(', ')}`);
    }

    return suggestions.length > 0 ? suggestions : ['Topic has strong viral potential across all dimensions.'];
  }

  private getTopicShort(topic: string): string {
    const words = topic.split(/\s+/);
    return words.slice(0, 3).join(' ');
  }

  private generateTitleVariations(topic: string): string[] {
    const variations: string[] = [];
    const words = topic.split(/\s+/);

    if (words.length >= 2) {
      variations.push(`Why ${words.slice(0, 3).join(' ')} Is More ${Math.random() > 0.5 ? 'Dangerous' : 'Important'} Than You Think`);
      variations.push(`${Math.floor(Math.random() * 10) + 1} ${topic.substring(0, 30)} Secrets Experts Won't Tell You`);
      variations.push(`I Tried ${topic.substring(0, 30)} for 30 Days — Here's What Happened`);
    }

    return variations.slice(0, 3);
  }

  // ────────────────────────────────────────────────────────
  //  PERSISTENCE
  // ────────────────────────────────────────────────────────

  private async savePredictionLog(report: ViralIntelligenceReport, projectId?: string): Promise<string> {
    try {
      const log = await prisma.viralPredictionLog.create({
        data: {
          projectId: projectId || null,
          topic: report.topic,
          category: report.category,
          trendScore: report.trendScore,
          competitionLevel: report.competitionLevel,
          searchDemand: report.searchDemand,
          noveltyScore: report.noveltyScore,
          ctrScore: report.ctrScore,
          retentionScore: report.retentionScore,
          monetizationScore: report.monetizationScore,
          saturationScore: report.saturationScore,
          viralScore: report.viralScore,
          decision: report.decision,
          improvementSuggestions: report.improvementSuggestions,
          weightsUsed: JSON.parse(JSON.stringify(this.weights)),
        },
      });
      return log.id;
    } catch (err: any) {
      logger.warn(`[ViralIntelligence] Failed to save prediction log: ${err.message}`);
      return '';
    }
  }

  private async upsertViralOpportunity(topic: string, category: TopicCategory, report: ViralIntelligenceReport): Promise<void> {
    try {
      await prisma.viralOpportunity.upsert({
        where: { topic },
        update: {
          niche: category,
          viralScore: report.viralScore,
          saturationScore: report.saturationScore,
          monetizationScore: report.monetizationScore,
          retentionProbability: report.retentionScore,
          ctrProbability: report.ctrScore,
          competitionLevel: this.competitionToNumber(report.competitionLevel),
          audienceSize: report.searchDemand > 70 ? 'large' : report.searchDemand > 40 ? 'medium' : 'small',
          growthVelocity: report.trendScore > 70 ? 'high' : report.trendScore > 40 ? 'medium' : 'low',
          emerging: report.noveltyScore > 70,
          lowCompetition: report.competitionLevel === 'low',
          seasonal: false,
          metadata: JSON.parse(JSON.stringify({ subScores: report.subScores, decision: report.decision })),
        },
        create: {
          topic,
          niche: category,
          viralScore: report.viralScore,
          saturationScore: report.saturationScore,
          monetizationScore: report.monetizationScore,
          retentionProbability: report.retentionScore,
          ctrProbability: report.ctrScore,
          competitionLevel: this.competitionToNumber(report.competitionLevel),
          audienceSize: report.searchDemand > 70 ? 'large' : report.searchDemand > 40 ? 'medium' : 'small',
          growthVelocity: report.trendScore > 70 ? 'high' : report.trendScore > 40 ? 'medium' : 'low',
          emerging: report.noveltyScore > 70,
          lowCompetition: report.competitionLevel === 'low',
          seasonal: false,
          source: 'viral-intelligence',
          metadata: JSON.parse(JSON.stringify({ subScores: report.subScores, decision: report.decision })),
        },
      });
    } catch (err: any) {
      logger.warn(`[ViralIntelligence] Failed to upsert ViralOpportunity: ${err.message}`);
    }
  }

  private competitionToNumber(level: 'low' | 'medium' | 'high'): number {
    return level === 'low' ? 20 : level === 'medium' ? 50 : 80;
  }

  // ────────────────────────────────────────────────────────
  //  SELF-LEARNING LOOP
  // ────────────────────────────────────────────────────────

  private async loadWeights(): Promise<void> {
    try {
      const configs = await prisma.viralWeightConfig.findMany();
      if (configs.length === 0) {
        // Seed default weights
        await this.seedDefaultWeights();
        return;
      }
      for (const config of configs) {
        switch (config.weightType) {
          case 'ctrWeight': this.weights.ctrWeight = config.value; break;
          case 'retentionWeight': this.weights.retentionWeight = config.value; break;
          case 'monetizationWeight': this.weights.monetizationWeight = config.value; break;
          case 'trendWeight': this.weights.trendWeight = config.value; break;
          case 'saturationPenalty': this.weights.saturationPenalty = config.value; break;
        }
      }
      logger.info(`[ViralIntelligence] Loaded weights: ${JSON.stringify(this.weights)}`);
    } catch (err: any) {
      logger.warn(`[ViralIntelligence] Failed to load weights, using defaults: ${err.message}`);
    }
  }

  private async seedDefaultWeights(): Promise<void> {
    const defaults: { key: string; value: number }[] = [
      { key: 'ctrWeight', value: DEFAULT_WEIGHTS.ctrWeight },
      { key: 'retentionWeight', value: DEFAULT_WEIGHTS.retentionWeight },
      { key: 'monetizationWeight', value: DEFAULT_WEIGHTS.monetizationWeight },
      { key: 'trendWeight', value: DEFAULT_WEIGHTS.trendWeight },
      { key: 'saturationPenalty', value: DEFAULT_WEIGHTS.saturationPenalty },
    ];
    for (const d of defaults) {
      await prisma.viralWeightConfig.upsert({
        where: { weightType: d.key },
        update: { value: d.value },
        create: { weightType: d.key, value: d.value },
      });
    }
  }

  private async adjustWeights(ctrError: number, retentionError: number): Promise<void> {
    try {
      const adjustmentRate = 0.005;
      const absCtrError = Math.abs(ctrError);
      const absRetentionError = Math.abs(retentionError);

      // If CTR prediction was too high, reduce CTR weight
      if (absCtrError > 10) {
        const direction = ctrError > 0 ? -1 : 1;
        await this.adjustWeight('ctrWeight', direction * adjustmentRate * (absCtrError / 20));
      }

      // If retention prediction was too high, reduce retention weight
      if (absRetentionError > 10) {
        const direction = retentionError > 0 ? -1 : 1;
        await this.adjustWeight('retentionWeight', direction * adjustmentRate * (absRetentionError / 20));
      }

      // Reload weights
      await this.loadWeights();
    } catch (err: any) {
      logger.warn(`[SelfLearning] Weight adjustment failed: ${err.message}`);
    }
  }

  private async adjustWeight(weightType: string, delta: number): Promise<void> {
    const config = await prisma.viralWeightConfig.findUnique({ where: { weightType } });
    if (!config) return;

    const newValue = Math.max(config.minValue, Math.min(config.maxValue, config.value + delta));
    await prisma.viralWeightConfig.update({
      where: { weightType },
      data: { value: newValue, sampleSize: { increment: 1 }, lastAdjustedAt: new Date() },
    });
  }

  private async storeWinningPatterns(
    project: { topic: string; id: string; analytics?: any; contentPerformance?: any; uploadHistory?: any },
    predictionLog: any,
  ): Promise<void> {
    try {
      const actualCTR = project.contentPerformance?.actualCTR || 0;
      const actualRetention = project.contentPerformance?.actualRetention || 0;
      const score = (actualCTR * 50 + actualRetention) / 2;

      // Store as WinningPattern (existing model)
      await prisma.winningPattern.upsert({
        where: {
          id: `pattern_${project.id}`,
        } as any, // use findFirst approach instead
        update: {
          score: Math.max(0, score),
          sampleSize: { increment: 1 },
          avgRetention: actualRetention,
          avgCTR: actualCTR,
          lastUsedAt: new Date(),
        },
        create: {
          id: `pattern_${project.id}`,
          category: predictionLog.category || 'general',
          niche: predictionLog.category || undefined,
          content: `Topic: ${project.topic}`,
          patternType: 'viral-topic',
          source: 'viral-intelligence-self-learning',
          score: Math.max(0, score),
          sampleSize: 1,
          avgRetention: actualRetention,
          avgCTR: actualCTR,
          confidence: Math.min(1, 0.5 + (score / 200)),
          metadata: { predictionLogId: predictionLog.id, ctrScore: predictionLog.ctrScore, retentionScore: predictionLog.retentionScore },
        },
      }).catch(async () => {
        // UPSERT on id fails because id is not in the unique constraint
        // Use create instead
        await prisma.winningPattern.create({
          data: {
            category: predictionLog.category || 'general',
            niche: predictionLog.category || undefined,
            content: `Topic: ${project.topic}`,
            patternType: 'viral-topic',
            source: 'viral-intelligence-self-learning',
            score: Math.max(0, score),
            sampleSize: 1,
            avgRetention: actualRetention,
            avgCTR: actualCTR,
            confidence: Math.min(1, 0.5 + (score / 200)),
            metadata: { predictionLogId: predictionLog.id, ctrScore: predictionLog.ctrScore, retentionScore: predictionLog.retentionScore },
          },
        });
      });

      // Also try to store an IncomeWinnerPattern for income system integration
      try {
        await prisma.incomeWinnerPattern.upsert({
          where: {
            id: `vi_${project.id}`,
          } as any,
          update: {
            score: Math.max(0, score),
            sampleSize: { increment: 1 },
            avgCtr: actualCTR,
            avgRetention: actualRetention,
            lastUsedAt: new Date(),
          },
          create: {
            id: `vi_${project.id}`,
            patternType: 'viral-topic',
            patternValue: project.topic,
            niche: predictionLog.category || '',
            score: Math.max(0, score),
            sampleSize: 1,
            avgCtr: actualCTR,
            avgRetention: actualRetention,
            confidence: Math.min(1, 0.5 + (score / 200)),
          },
        });
      } catch { /* income system may not be active */ }

      logger.info(`[SelfLearning] Stored winning pattern for "${project.topic}" (score: ${score.toFixed(1)})`);
    } catch (err: any) {
      logger.warn(`[SelfLearning] Failed to store winning pattern: ${err.message}`);
    }
  }

  private computeViralScoreFromActuals(actualCTRScore: number, actualRetentionScore: number, log: any): number {
    // Recompute viral score using the actual CTR/retention but keeping other scores from prediction
    return this.calculateViralScore(
      actualCTRScore,
      actualRetentionScore,
      log.monetizationScore || 50,
      log.trendScore || 50,
      log.saturationScore || 30,
    );
  }

  // ────────────────────────────────────────────────────────
  //  UTILITY: Fetch winning patterns for topic optimization
  // ────────────────────────────────────────────────────────

  async getWinningHooks(niche?: string, limit = 5): Promise<{ text: string; score: number }[]> {
    try {
      const patterns = await prisma.winningPattern.findMany({
        where: {
          patternType: 'hook-structure',
          ...(niche ? { niche } : {}),
        },
        orderBy: { score: 'desc' },
        take: limit,
      });
      return patterns.map(p => ({ text: p.content, score: p.score }));
    } catch {
      return [];
    }
  }

  async getTopViralTopics(niche?: string, limit = 10): Promise<{ topic: string; score: number }[]> {
    try {
      const opportunities = await prisma.viralOpportunity.findMany({
        where: {
          viralScore: { gte: 60 },
          ...(niche ? { niche } : {}),
        },
        orderBy: { viralScore: 'desc' },
        take: limit,
      });
      return opportunities.map(o => ({ topic: o.topic, score: o.viralScore }));
    } catch {
      return [];
    }
  }

  async scanOpportunities(): Promise<{ topic: string; viralScore: number; saturationScore: number; niche: string | null; emerging: boolean }[]> {
    try {
      const opportunities = await prisma.viralOpportunity.findMany({
        where: { viralScore: { gte: 60 }, saturationScore: { lt: 80 } },
        orderBy: { viralScore: 'desc' },
        take: 50,
      });
      return opportunities.map(o => ({
        topic: o.topic, viralScore: o.viralScore, saturationScore: o.saturationScore,
        niche: o.niche, emerging: o.emerging,
      }));
    } catch {
      return [];
    }
  }

  async getTopOpportunities(limit = 10, niche?: string): Promise<{ topic: string; viralScore: number; niche: string | null }[]> {
    try {
      const where: Record<string, unknown> = { viralScore: { gte: 60 } };
      if (niche) where.niche = niche;
      const opportunities = await prisma.viralOpportunity.findMany({
        where: where as any,
        orderBy: { viralScore: 'desc' },
        take: limit,
      });
      return opportunities.map(o => ({ topic: o.topic, viralScore: o.viralScore, niche: o.niche }));
    } catch {
      return [];
    }
  }

  async getPredictionAccuracyStats(): Promise<{ avgCtrError: number; avgRetentionError: number; totalPredictions: number }> {
    try {
      const logs = await prisma.viralPredictionLog.findMany({
        where: { ctrError: { not: null }, retentionError: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      if (logs.length === 0) return { avgCtrError: 0, avgRetentionError: 0, totalPredictions: 0 };

      const avgCtrError = logs.reduce((sum, l) => sum + Math.abs(l.ctrError || 0), 0) / logs.length;
      const avgRetentionError = logs.reduce((sum, l) => sum + Math.abs(l.retentionError || 0), 0) / logs.length;

      return { avgCtrError, avgRetentionError, totalPredictions: logs.length };
    } catch {
      return { avgCtrError: 0, avgRetentionError: 0, totalPredictions: 0 };
    }
  }
}
