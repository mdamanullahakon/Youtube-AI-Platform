import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { CommercialContentFilter } from './monetization/commercial-content-filter.service';
import { logger } from '../utils/logger';
import {
  UsaMarketReport,
  AudienceAlignmentScore,
  RpmFilterScore,
  HookEngineScore,
  SubscriberValueScore,
} from './usa-market.types';

const US_HIGH_CPM_NICHES = new Set([
  'ai', 'artificial intelligence', 'finance', 'investing', 'business',
  'software', 'saas', 'tech', 'productivity', 'marketing', 'real estate',
  'crypto', 'ecommerce', 'entrepreneurship', 'wealth', 'money',
]);

const US_BLOCKED_NICHES = new Set([
  'gaming clip', 'memes', 'funny compilation', 'music video',
  'drama', 'gossip', 'celebrities', 'local news',
]);

const US_HOOK_TEMPLATES = [
  "This {topic} tool is quietly replacing {jobCount} jobs in 2026",
  "Most Americans are using {topic} wrong — here's the fix",
  "You're losing money if you don't use this {topic} system",
  "The {topic} secret that US companies don't want you to know",
  "Why {topic} is the #1 skill for Americans in 2026",
  "I tried {topic} for 30 days — the results shocked me",
  "This {topic} strategy made me $X in Y months (US only)",
  "Stop doing {topic} the hard way — Americans use this instead",
  "The US government doesn't want you to know this about {topic}",
  "How {topic} is creating millionaires in America right now",
];

const NICHE_CPM_USD: Record<string, number> = {
  ai: 15, finance: 20, investing: 18, business: 14, insurance: 22,
  software: 12, saas: 14, tech: 10, productivity: 8, marketing: 10,
  'real estate': 16, crypto: 18, ecommerce: 12, entrepreneurship: 10,
  wealth: 20, money: 18, education: 6, health: 8, fitness: 5,
  'self improvement': 6, howto: 4, science: 5, career: 8,
};

export class UsaMarketOptimizer {
  private commercialFilter: CommercialContentFilter;

  constructor() {
    this.commercialFilter = new CommercialContentFilter();
  }

  async analyzeTopic(topic: string, keywords: string[] = []): Promise<UsaMarketReport> {
    logger.info(`[UsaMarket] Analyzing "${topic}" for USA market fit`);

    const [audienceAlignment, rpmFilter, hookResult, subscriberValue] = await Promise.all([
      this.evaluateAudienceAlignment(topic),
      this.evaluateRpmPotential(topic, keywords),
      this.evaluateHookStrength(topic),
      this.evaluateSubscriberValue(topic),
    ]);

    const ctrPredictionUsa = this.predictUsCtr(topic, audienceAlignment, rpmFilter);
    const retentionPredictionUsa = this.predictUsRetention(topic, audienceAlignment);
    const hookStrengthScore = hookResult.score;
    const bestUsTitle = this.generateLocalizedTitle(topic);
    const bestUploadTimeEst = this.getBestUsUploadTime();

    const usaViralScore = Math.round(
      ctrPredictionUsa * 0.30 +
      retentionPredictionUsa * 0.30 +
      rpmFilter.score * 0.25 +
      audienceAlignment.score * 0.15
    );

    const finalDecision = usaViralScore >= 85 ? 'PUBLISH'
      : usaViralScore >= 75 ? 'OPTIMIZE'
      : 'REJECT';

    const improvementNotes: string[] = [];
    if (audienceAlignment.score < 70) improvementNotes.push('Improve US cultural relevance — use American examples, USD currency, imperial units');
    if (rpmFilter.score < 60) improvementNotes.push('Low RPM niche — consider reframing topic toward AI, finance, or business angle');
    if (hookStrengthScore < 70) improvementNotes.push('Hook needs stronger US-style curiosity gap and direct value promise');
    if (ctrPredictionUsa < 60) improvementNotes.push('CTR potential low — rewrite title with US audience triggers and power words');
    if (retentionPredictionUsa < 60) improvementNotes.push('Retention risk — ensure fast pacing, American English, and direct structure');

    const localizedDescription = this.generateLocalizedDescription(topic, audienceAlignment, rpmFilter);

    return {
      topic,
      usaAudienceFitScore: audienceAlignment.score,
      rpmScore: rpmFilter.score,
      ctrPredictionUsa,
      retentionPredictionUsa,
      hookStrengthScore,
      bestUsTitle,
      bestUploadTimeEst,
      finalDecision,
      usaViralScore,
      subScores: { audienceAlignment, rpmFilter, hookEngine: hookResult, subscriberValue },
      localizedTitle: bestUsTitle,
      localizedDescription,
      improvementNotes,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 1: USA AUDIENCE ALIGNMENT ENGINE
  // ────────────────────────────────────────────────────────────

  private async evaluateAudienceAlignment(topic: string): Promise<AudienceAlignmentScore> {
    const lower = topic.toLowerCase();
    const issues: string[] = [];

    // Language naturalness
    let languageNatural = 80;
    const roboticPhrases = ['today we will', 'in this video', 'we shall', 'let us explore', 'in order to', 'utilize'];
    for (const phrase of roboticPhrases) {
      if (lower.includes(phrase)) { languageNatural -= 15; issues.push(`Robotic phrasing: "${phrase}"`); }
    }
    if (/\b(gbp|eur|inr|pounds|euros|rupees)\b/.test(lower)) {
      languageNatural -= 20;
      issues.push('Non-USD currency detected — must use US dollars');
    }
    if (/\b(kilometer|centimetre|litre|kg)\b/.test(lower)) {
      languageNatural -= 10;
      issues.push('Metric units detected — use imperial (miles, pounds, inches)');
    }

    // Cultural relevance
    let culturalRelevance = 50;
    const usReferences = ['us', 'usa', 'america', 'american', 'united states', 'us market', 'us companies',
      'silicon valley', 'wall street', 'new york', 'california', 'texas', 'miami', 'los angeles',
      'dollar', 'usd', 'social security', '401k', 'irs', 'fdic', 'sec',
      'amazon', 'google', 'apple', 'microsoft', 'meta', 'tesla', 'netflix',
      'harvard', 'mit', 'stanford', 'ivy league', 'nfl', 'nba', 'super bowl'];

    for (const ref of usReferences) {
      if (lower.includes(ref)) culturalRelevance += 8;
    }

    // Penalty for non-US references
    const nonUsRefs = ['uk government', 'bbc', 'paris', 'london', 'european', 'euro', 'china market', 'india market', 'australian'];
    for (const ref of nonUsRefs) {
      if (lower.includes(ref)) { culturalRelevance -= 10; issues.push(`Non-US reference: "${ref}"`); }
    }

    culturalRelevance = Math.min(100, Math.max(0, culturalRelevance));

    // Currency & unit system
    const currencyUnit = !/\b(gbp|eur|inr|pounds|euros|rupees|yen|yuan)\b/.test(lower);
    const unitSystem = !/\b(kilometer|centimetre|metre|litre)\b/.test(lower);

    // Tone match
    let toneMatch = 75;
    if (/\b(passionate|delightful|splendid|quite|rather|perhaps)\b/.test(lower)) toneMatch -= 10;
    if (/\b(awesome|amazing|literally|gonna|wanna|gotta)\b/.test(lower)) toneMatch += 10;
    if (lower.split(/\s+/).length <= 8) toneMatch += 10;

    const score = Math.round(
      languageNatural * 0.30 +
      culturalRelevance * 0.30 +
      (currencyUnit ? 100 : 30) * 0.15 +
      (unitSystem ? 100 : 30) * 0.10 +
      toneMatch * 0.15
    );

    return { score: Math.min(100, Math.max(0, score)), languageNatural, culturalRelevance, currencyUnit, unitSystem, toneMatch, issues };
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 2: HIGH RPM TOPIC FILTER
  // ────────────────────────────────────────────────────────────

  private async evaluateRpmPotential(topic: string, keywords: string[]): Promise<RpmFilterScore> {
    const lower = topic.toLowerCase();

    // Check blocked niches first
    for (const blocked of US_BLOCKED_NICHES) {
      if (lower.includes(blocked)) {
        return { score: 15, nicheTier: 'low', estimatedCpmUsd: 1.5, estimatedRpmUsd: 0.50, nicheCategory: 'blocked' };
      }
    }

    // Find matching CPM niche
    let highestCpm = 4;
    let matchedNiche = 'general';
    for (const [niche, cpm] of Object.entries(NICHE_CPM_USD)) {
      if (lower.includes(niche) && cpm > highestCpm) {
        highestCpm = cpm;
        matchedNiche = niche;
      }
    }

    // Use commercial filter for enhanced analysis
    let commercialScore = 50;
    try {
      const commercial = await this.commercialFilter.evaluateTopic(topic, keywords);
      commercialScore = commercial.commercialIntentScore;
      highestCpm = Math.max(highestCpm, commercial.estimatedCPM);
      if (commercial.cpmTier === 'premium' || commercial.cpmTier === 'high') matchedNiche = commercial.topic;
    } catch { /* use keyword-based scoring */ }

    // Bonus for high-value modifiers
    let cpmBoost = 0;
    if (/\b(software|tool|app|platform|automation|ai)\b/.test(lower)) cpmBoost += 4;
    if (/\b(invest|money|wealth|income|passive|profit|revenue)\b/.test(lower)) cpmBoost += 6;
    if (/\b(course|learn|training|certification|skill)\b/.test(lower)) cpmBoost += 2;
    if (/\b(comparison|review|vs|alternative|best|top)\b/.test(lower)) cpmBoost += 3;

    highestCpm = Math.min(25, highestCpm + cpmBoost);
    const estimatedRpm = Math.round(highestCpm * 0.55 * 100) / 100; // ~55% of CPM for creators

    // Score based on CPM tier
    let score: number;
    let nicheTier: 'premium' | 'high' | 'medium' | 'low';

    if (highestCpm >= 14) { score = 90 + Math.min(10, (highestCpm - 14) * 2); nicheTier = 'premium'; }
    else if (highestCpm >= 10) { score = 70 + (highestCpm - 10) * 5; nicheTier = 'high'; }
    else if (highestCpm >= 6) { score = 50 + (highestCpm - 6) * 5; nicheTier = 'medium'; }
    else { score = Math.max(10, highestCpm * 8); nicheTier = 'low'; }

    return {
      score: Math.min(100, Math.round(score)),
      nicheTier,
      estimatedCpmUsd: highestCpm,
      estimatedRpmUsd: estimatedRpm,
      nicheCategory: matchedNiche,
    };
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 3: USA TIMEZONE OPTIMIZATION
  // ────────────────────────────────────────────────────────────

  getBestUsUploadTime(): string {
    // Primary: 12PM-3PM EST (pre-work/pre-lunch browsing)
    // Secondary: 6PM-9PM EST (after-work prime time)
    const slots = [
      { time: '12:00 PM EST', score: 92, label: 'Lunch break peak' },
      { time: '1:00 PM EST', score: 90, label: 'Post-lunch browsing' },
      { time: '2:00 PM EST', score: 85, label: 'Afternoon dip' },
      { time: '6:00 PM EST', score: 95, label: 'After-work prime' },
      { time: '7:00 PM EST', score: 98, label: 'Evening peak — highest US engagement' },
      { time: '8:00 PM EST', score: 96, label: 'Prime time' },
    ];

    // Weight recommendation: 7PM EST is the optimal single slot
    return '7:00 PM EST (evening peak — highest US engagement)';
  }

  getUsUploadSchedule(): { estSlot: string; pstSlot: string; confidence: number }[] {
    return [
      { estSlot: '7:00 PM', pstSlot: '4:00 PM', confidence: 0.95 },
      { estSlot: '12:00 PM', pstSlot: '9:00 AM', confidence: 0.88 },
      { estSlot: '6:00 PM', pstSlot: '3:00 PM', confidence: 0.90 },
      { estSlot: '2:00 PM', pstSlot: '11:00 AM', confidence: 0.82 },
    ];
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 4: US-STYLE HOOK ENGINE
  // ────────────────────────────────────────────────────────────

  private async evaluateHookStrength(topic: string): Promise<HookEngineScore> {
    const lower = topic.toLowerCase();

    let curiosityGap = 40;
    if (/\b(why|how|what|secret|truth|hidden|nobody|nobody knows|revealed|actually)\b/.test(lower)) curiosityGap += 25;
    if (/\b(this|these|the real|the actual|what happens|what if)\b/.test(lower)) curiosityGap += 15;
    if (/\b(\d+|\d+\.\d+)\b/.test(lower)) curiosityGap += 15;
    if (lower.includes('?')) curiosityGap += 10;

    let valuePromise = 40;
    if (/\b(save|earn|make|get|build|create|grow|improve|master|learn|discover)\b/.test(lower)) valuePromise += 20;
    if (/\b(guide|tutorial|how to|step|method|system|strategy|framework)\b/.test(lower)) valuePromise += 20;
    if (/\b(free|without|easy|simple|fast|quick|automated)\b/.test(lower)) valuePromise += 10;

    let pacing = 60;
    const wordCount = lower.split(/\s+/).length;
    if (wordCount >= 5 && wordCount <= 15) pacing += 20;
    if (wordCount < 5) pacing += 10;
    if (wordCount > 20) pacing -= 10;

    let usStyle = 50;
    const usStyleWords = ['you\'re', 'don\'t', 'won\'t', 'can\'t', 'gonna', 'wanna', 'gotta', 'awesome', 'literally', 'actually', 'honestly', 'basically', 'here\'s', 'here is', 'this is', 'check out', 'real quick', 'by the way'];
    for (const word of usStyleWords) { if (lower.includes(word)) usStyle += 8; }
    if (/\b(get|make|save)\s+(free|more|better|rich|easy|fast)\b/.test(lower)) usStyle += 10;

    curiosityGap = Math.min(100, curiosityGap);
    valuePromise = Math.min(100, valuePromise);
    pacing = Math.min(100, pacing);
    usStyle = Math.min(100, usStyle);

    const score = Math.round(curiosityGap * 0.30 + valuePromise * 0.30 + pacing * 0.20 + usStyle * 0.20);

    const suggestions: string[] = [];
    if (curiosityGap < 60) suggestions.push('Add curiosity trigger: "Why/How/Secret/Truth" in first 3 words');
    if (valuePromise < 60) suggestions.push('Add direct value promise: "Save money", "Build skills", "Grow income"');
    if (usStyle < 60) suggestions.push('Use casual American English: contractions, direct address ("you"), short words');

    return { score, curiosityGap, valuePromise, pacing, usStyle, suggestions };
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 5: USA VIRALITY SCORE (internal helpers)
  // ────────────────────────────────────────────────────────────

  private predictUsCtr(topic: string, alignment: AudienceAlignmentScore, rpm: RpmFilterScore): number {
    const base = 40;
    const alignmentBoost = (alignment.score / 100) * 25;
    const rpmBoost = (rpm.score / 100) * 15;
    const hookBoost = /[0-9]/.test(topic) ? 8 : 0;
    const emotionBoost = /\b(shock|secret|hidden|truth|revealed|why|how)\b/.test(topic) ? 12 : 0;

    return Math.min(100, Math.round(base + alignmentBoost + rpmBoost + hookBoost + emotionBoost));
  }

  private predictUsRetention(topic: string, alignment: AudienceAlignmentScore): number {
    const base = 35;
    const alignmentBoost = (alignment.score / 100) * 25;
    const structureBoost = /\b(step|guide|tutorial|how to|method|ways|reasons|tips)\b/.test(topic) ? 15 : 5;
    const storyBoost = /\b(story|journey|experience|happened|tried|case study)\b/.test(topic) ? 10 : 0;

    return Math.min(100, Math.round(base + alignmentBoost + structureBoost + storyBoost));
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 6: LOCALIZATION TRANSFORMATION ENGINE
  // ────────────────────────────────────────────────────────────

  generateLocalizedTitle(topic: string): string {
    const lower = topic.toLowerCase();

    // Strip non-US currencies
    let title = topic.replace(/£[\d,]+/g, '$$$&').replace(/€[\d,]+/g, '$$$&');
    title = title.replace(/\b(GBP|EUR|INR|pounds|euros|rupees)\b/gi, 'USD');

    // Replace metric with imperial
    title = title.replace(/\b(\d+)\s*kilometers?\b/gi, (_, n) => `${Math.round(parseInt(n) * 0.621)} miles`);
    title = title.replace(/\b(\d+)\s*kilogram\b/gi, (_, n) => `${Math.round(parseInt(n) * 2.205)} pounds`);

    // Remove non-US cultural references and replace with US equivalents
    title = title.replace(/\b(BBC|Channel 4|Guardian|Telegraph)\b/gi, 'US News');
    title = title.replace(/\b(pounds|pence)\b/gi, 'dollars');

    // Apply US title style: shorter, punchier, value-first
    if (!/[\d!?]/.test(title) && title.length > 40) {
      title = title.substring(0, 37) + '...';
    }

    return title.trim();
  }

  private generateLocalizedDescription(topic: string, alignment: AudienceAlignmentScore, rpm: RpmFilterScore): string {
    const lines: string[] = [];
    lines.push(`🇺🇸 USA Audience — Optimized for US viewers`);

    if (rpm.nicheTier === 'premium' || rpm.nicheTier === 'high') {
      lines.push(`💰 High-Value Content — Estimated US RPM: $${rpm.estimatedRpmUsd.toFixed(2)}`);
    }

    if (alignment.score < 70) {
      lines.push(`📝 Note: This topic has been localized for US audience (USD currency, US examples, American English).`);
    }

    lines.push('');
    lines.push(`In this video, we cover ${topic.toLowerCase()} from an American perspective.`);
    lines.push(`All examples use US companies, US pricing in USD, and US market data.`);

    return lines.join('\n');
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 7: SUBSCRIBER VALUE OPTIMIZER
  // ────────────────────────────────────────────────────────────

  private async evaluateSubscriberValue(topic: string): Promise<SubscriberValueScore> {
    const lower = topic.toLowerCase();

    let targetDemographic = 'general US audience';
    let valueAlignment = 50;
    let usMarketDemand = 50;

    // Professionals
    if (/\b(business|entrepreneur|startup|marketing|sales|management|leadership|strategy|consulting|career|job|resume|interview|promotion)\b/.test(lower)) {
      targetDemographic = 'US professionals & executives';
      valueAlignment = 85;
      usMarketDemand = 80;
    }
    // Students
    else if (/\b(college|study|student|scholarship|internship|degree|certification|exam|SAT|GRE|GMAT|graduate|undergrad)\b/.test(lower)) {
      targetDemographic = 'US students & recent graduates';
      valueAlignment = 75;
      usMarketDemand = 70;
    }
    // Entrepreneurs
    else if (/\b(side hustle|passive income|ecommerce|dropshipping|affiliate|freelance|gig|self-employed|business owner|small business)\b/.test(lower)) {
      targetDemographic = 'US entrepreneurs & side hustlers';
      valueAlignment = 90;
      usMarketDemand = 85;
    }
    // Tech users
    else if (/\b(software|app|tool|ai|automation|coding|programming|developer|tech|startup|digital|saas|cloud)\b/.test(lower)) {
      targetDemographic = 'US tech professionals & power users';
      valueAlignment = 85;
      usMarketDemand = 82;
    }
    // Investors
    else if (/\b(invest|stock|crypto|real estate|retire|wealth|money|finance|trading|portfolio|dividend)\b/.test(lower)) {
      targetDemographic = 'US investors & wealth builders';
      valueAlignment = 92;
      usMarketDemand = 88;
    }

    // Adjust based on US alignment
    const alignmentBonus = Math.round((valueAlignment / 100) * 10);
    usMarketDemand = Math.min(100, usMarketDemand + alignmentBonus);

    const score = Math.round(valueAlignment * 0.55 + usMarketDemand * 0.45);

    return { score: Math.min(100, Math.max(0, score)), targetDemographic, valueAlignment, usMarketDemand };
  }

  // ────────────────────────────────────────────────────────────
  //  PUBLIC API: generate US-optimized hook
  // ────────────────────────────────────────────────────────────

  generateUsHook(topic: string): string {
    const words = topic.split(/\s+/);
    const shortTopic = words.slice(0, 3).join(' ');
    const template = US_HOOK_TEMPLATES[Math.floor(Math.random() * US_HOOK_TEMPLATES.length)];

    let hook = template
      .replace('{topic}', shortTopic)
      .replace('{jobCount}', String(Math.floor(Math.random() * 5) + 2));

    // Replace X with a realistic dollar amount
    hook = hook.replace('$X', `$${Math.floor(Math.random() * 9000 + 1000)}`);
    hook = hook.replace('Y months', `${Math.floor(Math.random() * 6 + 2)} months`);

    return hook;
  }

  generateUsTitleVariations(topic: string): string[] {
    const words = topic.split(/\s+/);
    const short = words.slice(0, 4).join(' ');

    return [
      `Why ${short} Is the Best Investment for Americans in 2026`,
      `You're Using ${short} Wrong — Here's the US Market Secret`,
      `The ${short} Strategy That Made Me $${Math.floor(Math.random() * 5000 + 500)}/Month`,
      `${Math.floor(Math.random() * 7 + 3)} ${short} Tips That Actually Work in the US`,
      `Stop Wasting Money on ${short} — Do This Instead (USA)`,
    ];
  }

  async getUsHighRpmTopics(limit = 10): Promise<{ topic: string; cpm: number }[]> {
    try {
      const opportunities = await prisma.viralOpportunity.findMany({
        where: { monetizationScore: { gte: 60 } },
        orderBy: { monetizationScore: 'desc' },
        take: limit,
      });

      return opportunities.map(o => {
        const matchedCpm = Object.entries(NICHE_CPM_USD)
          .find(([niche]) => o.topic.toLowerCase().includes(niche));
        return { topic: o.topic, cpm: matchedCpm ? matchedCpm[1] : 4 };
      });
    } catch {
      return Object.entries(NICHE_CPM_USD).slice(0, limit).map(([topic, cpm]) => ({ topic, cpm }));
    }
  }
}
