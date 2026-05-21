import { prisma } from '../config/db';
import { logger } from '../utils/logger';

interface RpmPrediction {
  predictedRpm: number;
  confidence: 'low' | 'medium' | 'high';
  factors: {
    nicheBase: number;
    channelHistory: number;
    seasonality: number;
    contentLength: number;
  };
}

interface RevenueOptimization {
  estimatedRevenue: number;
  optimizations: {
    titleScore: number;
    thumbnailScore: number;
    timingScore: number;
    affiliateScore: number;
    viralScore: number;
  };
  recommendations: string[];
}

interface ProjectData {
  topic: string;
  title: string | null;
  channelId: string | null;
  script?: { content: string; hook?: string | null } | null;
  analytics?: { views: number; ctr: number; retention: number } | null;
}

const NICHE_RPM: Record<string, number> = {
  finance: 15, investing: 15, crypto: 12, money: 10,
  technology: 8, ai: 8, programming: 7, software: 7,
  business: 10, marketing: 9, entrepreneurship: 10,
  education: 5, science: 4, history: 4,
  entertainment: 2, gaming: 2, music: 1.5, vlog: 1,
};

const DEFAULT_RPM = 3.5;

const AFFILIATE_KEYWORDS = ['best', 'review', 'top', 'vs', 'tutorial', 'comparison', 'alternative', 'discount', 'coupon', 'deal', 'save', 'guide', 'how to'];

const HIGH_AFFINITY_NICHES = new Set(['finance', 'investing', 'technology', 'ai', 'software', 'business', 'marketing', 'entrepreneurship', 'crypto', 'money']);

const LOW_AFFINITY_NICHES = new Set(['music', 'vlog', 'entertainment', 'gaming']);

const POWER_WORDS = ['truth', 'secret', 'hidden', 'found', 'never', 'before', 'finally', 'revealed', 'destroyed', 'changed', 'shocked', 'exposed', 'warning', 'urgent', 'crucial', 'essential', 'ultimate', 'guaranteed', 'proven', 'insane'];

const TRENDING_PATTERNS = ['ai', 'artificial intelligence', 'chatgpt', 'machine learning', 'crypto', 'bitcoin', 'blockchain', 'quantum', 'saas', 'startup', 'passive income', 'side hustle', 'remote work', 'digital nomad', 'productivity', 'self improvement', 'how to', 'tutorial', 'review', 'comparison', 'vs'];

const CURRENT_YEAR = new Date().getFullYear();

function getNicheRpm(topic: string): number {
  const tl = topic.toLowerCase();
  for (const [niche, rpm] of Object.entries(NICHE_RPM)) {
    if (tl.includes(niche)) return rpm;
  }
  return DEFAULT_RPM;
}

function nicheAffinity(niche: string): 'high' | 'medium' | 'low' {
  const n = niche.toLowerCase();
  if (HIGH_AFFINITY_NICHES.has(n)) return 'high';
  if (LOW_AFFINITY_NICHES.has(n)) return 'low';
  return 'medium';
}

class MonetizationEngine {
  // ────────────────────────────────────────────────────────────
  // 1. RPM PREDICTION MODEL PER CHANNEL
  // ────────────────────────────────────────────────────────────

  async predictRpm(channelId: string, topic: string, duration: number): Promise<RpmPrediction> {
    try {
      const nicheBase = getNicheRpm(topic);

      let channelHistory = 1.0;
      try {
        const lastUploads = await prisma.contentPerformance.findMany({
          where: { project: { channelId } },
          orderBy: { updatedAt: 'desc' },
          take: 5,
          select: { actualViews: true },
        });
        if (lastUploads.length > 0) {
          const avgRpm = lastUploads.reduce((sum, u) => {
            const estimatedViews = u.actualViews || 1000;
            return sum + (estimatedViews > 0 ? (estimatedViews * 0.0035) : 3.5);
          }, 0) / lastUploads.length;
          channelHistory = avgRpm / DEFAULT_RPM;
          channelHistory = Math.max(0.5, Math.min(3.0, channelHistory));
        }
      } catch {
        channelHistory = 1.0;
      }

      const month = new Date().getMonth();
      let seasonality = 1.0;
      if (topic.toLowerCase().includes('finance') || topic.toLowerCase().includes('investing')) {
        if (month >= 0 && month <= 2) seasonality = 1.15;
        else if (month >= 3 && month <= 5) seasonality = 1.05;
        else if (month >= 9 && month <= 11) seasonality = 1.20;
        else seasonality = 0.95;
      } else if (topic.toLowerCase().includes('education')) {
        if (month >= 8 && month <= 11) seasonality = 1.25;
        else seasonality = 0.90;
      } else if (topic.toLowerCase().includes('technology') || topic.toLowerCase().includes('ai')) {
        seasonality = 1.10;
      } else {
        seasonality = 1.0;
      }

      const contentLength = duration >= 10 ? 1.2 : duration >= 5 ? 1.1 : duration >= 3 ? 1.0 : 0.9;

      let predictedRpm = nicheBase * channelHistory * seasonality * contentLength;
      predictedRpm = Math.max(0.5, Math.min(50, Math.round(predictedRpm * 100) / 100));

      const confidence: 'low' | 'medium' | 'high' = channelHistory >= 0.8 ? 'high' : channelHistory >= 0.5 ? 'medium' : 'low';

      return {
        predictedRpm,
        confidence,
        factors: {
          nicheBase: Math.round(nicheBase * 100) / 100,
          channelHistory: Math.round(channelHistory * 100) / 100,
          seasonality: Math.round(seasonality * 100) / 100,
          contentLength: Math.round(contentLength * 100) / 100,
        },
      };
    } catch (err: any) {
      logger.warn(`[MonetizationEngine] predictRpm failed: ${err.message}`);
      return {
        predictedRpm: DEFAULT_RPM,
        confidence: 'low',
        factors: { nicheBase: DEFAULT_RPM, channelHistory: 1.0, seasonality: 1.0, contentLength: 1.0 },
      };
    }
  }

  // ────────────────────────────────────────────────────────────
  // 2. AFFILIATE INJECTION SCORING
  // ────────────────────────────────────────────────────────────

  scoreAffiliateOpportunity(script: string, niche: string): number {
    try {
      const lower = script.toLowerCase();
      let score = 0;

      const matchedKeywords = AFFILIATE_KEYWORDS.filter(kw => lower.includes(kw));
      score += Math.min(40, matchedKeywords.length * 10);

      const affinity = nicheAffinity(niche);
      if (affinity === 'high') score += 30;
      else if (affinity === 'medium') score += 15;
      else score += 0;

      if (/\b(buy|purchase|get|order|try|sign up|download|install)\b/.test(lower)) score += 15;
      if (/\b(price|cost|cheap|expensive|affordable|budget)\b/.test(lower)) score += 10;
      if (/\b(link|below|description|check it out)\b/.test(lower)) score += 5;

      return Math.min(100, Math.max(0, score));
    } catch {
      return 0;
    }
  }

  suggestAffiliateLinks(niche: string): string[] {
    const n = niche.toLowerCase();
    if (n.includes('finance') || n.includes('investing') || n.includes('crypto')) {
      return ['Trading platforms', 'Crypto exchanges', 'Portfolio trackers', 'Tax software', 'Banking apps'];
    }
    if (n.includes('technology') || n.includes('ai') || n.includes('software')) {
      return ['SaaS tools', 'AI writing assistants', 'VPN services', 'Web hosting', 'Productivity software'];
    }
    if (n.includes('business') || n.includes('marketing') || n.includes('entrepreneurship')) {
      return ['Email marketing tools', 'CRM software', 'Course platforms', 'Agency tools', 'Consulting services'];
    }
    if (n.includes('education')) {
      return ['Online course platforms', 'E-book platforms', 'Tutoring services', 'Study apps', 'Educational software'];
    }
    if (n.includes('health') || n.includes('fitness')) {
      return ['Supplements', 'Fitness equipment', 'Meal plan services', 'Workout apps', 'Wellness products'];
    }
    if (n.includes('gaming')) {
      return ['Gaming chairs', 'Headsets', 'Capture cards', 'Game keys', 'Merchandise'];
    }
    return ['Digital products', 'Online courses', 'Software subscriptions', 'Affiliate networks', 'Sponsored content'];
  }

  shouldInjectAffiliate(score: number): boolean {
    return score >= 30;
  }

  // ────────────────────────────────────────────────────────────
  // 3. VIRAL PROBABILITY MULTIPLIER
  // ────────────────────────────────────────────────────────────

  predictViralProbability(script: string, title: string, topic: string): number {
    try {
      const hook = script.substring(0, 50).toLowerCase();
      const titleLower = title.toLowerCase();
      let score = 0.3;

      if (hook.includes('?')) score += 0.15;
      if (hook.match(/\d+/)) score += 0.10;
      if (POWER_WORDS.some(w => hook.includes(w))) score += 0.10;

      const trendMatch = TRENDING_PATTERNS.filter(t => topic.toLowerCase().includes(t) || titleLower.includes(t));
      score += Math.min(0.20, trendMatch.length * 0.05);

      if (titleLower.includes('?')) score += 0.08;
      if (titleLower.match(/^\d+/)) score += 0.08;
      if (titleLower.includes('you') || titleLower.includes('your')) score += 0.07;
      const powerInTitle = POWER_WORDS.filter(w => titleLower.includes(w)).length;
      score += Math.min(0.12, powerInTitle * 0.04);
      if (titleLower.includes(CURRENT_YEAR.toString()) || titleLower.includes('this year')) score += 0.05;

      const titleLen = title.length;
      if (titleLen >= 30 && titleLen <= 60) score += 0.05;
      if (titleLen > 80) score -= 0.05;

      if (script.length > 500) score += 0.05;

      return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
    } catch {
      return 0.3;
    }
  }

  getViralMultiplier(prob: number): number {
    if (prob >= 0.8) return 5.0;
    if (prob >= 0.6) return 3.0;
    if (prob >= 0.4) return 2.0;
    if (prob >= 0.2) return 1.5;
    return 1.0;
  }

  // ────────────────────────────────────────────────────────────
  // 4. WATCH-TIME OPTIMIZATION ENGINE
  // ────────────────────────────────────────────────────────────

  optimizeScriptPacing(script: string): { optimized: string; predictedRetention: number } {
    try {
      const sentences = script.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const lengths = sentences.map(s => s.split(/\s+/).filter(w => w.length > 0).length);
      const avgLength = lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;

      const uniqueLengths = new Set(lengths.map(l => Math.round(l / 3) * 3)).size;
      const lengthVariety = lengths.length > 0 ? uniqueLengths / Math.min(lengths.length, 10) : 0;
      const pacingScore = lengthVariety > 0.5 ? 0.8 : lengthVariety > 0.3 ? 0.6 : 0.4;

      const words = script.split(/\s+/).filter(w => w.length > 0);
      const estimatedMinutes = words.length / 150;
      const questionCount = (script.match(/\?/g) || []).length;
      const questionsPerMinute = estimatedMinutes > 0 ? questionCount / estimatedMinutes : 0;
      const optimalQuestions = questionsPerMinute >= 0.5 && questionsPerMinute <= 2.0;

      const wordsArr = script.split(/\s+/).filter(w => w.length > 0);
      const sentencesArr = wordsArr.length > 0 ? sentences : [];
      const avgSentenceWords = sentencesArr.length > 0
        ? sentencesArr.reduce((s, sen) => s + sen.split(/\s+/).filter(w => w.length > 0).length, 0) / sentencesArr.length
        : 15;

      let optimized = script;
      if (!optimalQuestions && estimatedMinutes > 1) {
        const paragraphs = script.split(/\n\s*\n/);
        optimized = paragraphs.map((p, i) => {
          if (i > 0 && i < paragraphs.length - 1 && !p.includes('?') && p.trim().length > 50) {
            return `But here's the thing: ${p.trim()}`;
          }
          return p;
        }).join('\n\n');
      }

      const retention = this.predictRetention(script);

      return { optimized, predictedRetention: retention };
    } catch {
      return { optimized: script, predictedRetention: 50 };
    }
  }

  predictRetention(script: string): number {
    try {
      const sentences = script.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const words = script.split(/\s+/).filter(w => w.length > 0);
      if (sentences.length === 0 || words.length === 0) return 30;

      const sentenceLengths = sentences.map(s => s.split(/\s+/).filter(w => w.length > 0).length);
      const avgSentenceLen = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
      const stdDev = Math.sqrt(sentenceLengths.reduce((sum, l) => sum + (l - avgSentenceLen) ** 2, 0) / sentenceLengths.length);
      const variationRatio = avgSentenceLen > 0 ? stdDev / avgSentenceLen : 0;

      let score = 40;

      if (variationRatio >= 0.4 && variationRatio <= 1.0) score += 15;
      else if (variationRatio > 0.2) score += 8;
      else score -= 10;

      const questionCount = (script.match(/\?/g) || []).length;
      const estimatedMinutes = words.length / 150;
      const qpm = estimatedMinutes > 0 ? questionCount / estimatedMinutes : 0;
      if (qpm >= 0.5 && qpm <= 2.0) score += 12;
      else if (qpm > 2.0) score += 6;
      else score -= 5;

      if (avgSentenceLen >= 8 && avgSentenceLen <= 20) score += 10;
      else if (avgSentenceLen > 25) score -= 8;

      if (script.includes('...')) score += 5;
      if (script.includes('!')) score += 5;
      if (/[A-Z]{3,}/.test(script)) score += 3;

      if (words.length > 1000) score += 5;
      if (words.length > 2000) score += 3;

      return Math.max(0, Math.min(100, Math.round(score)));
    } catch {
      return 50;
    }
  }

  // ────────────────────────────────────────────────────────────
  // 5. UPLOAD TIMING OPTIMIZER (TIMEZONE-BASED)
  // ────────────────────────────────────────────────────────────

  async getOptimalUploadTime(channelId: string): Promise<{ hour: number; dayOfWeek: number; timezone: string }> {
    try {
      const metrics = await prisma.uploadTimeMetric.findMany({
        where: { channelId },
        orderBy: { score: 'desc' },
        take: 1,
      });

      if (metrics.length > 0) {
        const best = metrics[0];
        const dayMap: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
        return {
          hour: best.uploadHour,
          dayOfWeek: dayMap[best.uploadDay?.toLowerCase()] ?? 2,
          timezone: best.timezone || 'America/New_York',
        };
      }

      const channel = await prisma.youTubeAccount.findUnique({ where: { id: channelId } });
      if (channel) {
        return { hour: 14, dayOfWeek: 2, timezone: 'America/New_York' };
      }

      return { hour: 14, dayOfWeek: 2, timezone: 'America/New_York' };
    } catch {
      return { hour: 14, dayOfWeek: 2, timezone: 'America/New_York' };
    }
  }

  async getUploadDelayMs(channelId: string): Promise<number> {
    try {
      const { hour, dayOfWeek, timezone } = await this.getOptimalUploadTime(channelId);

      const now = new Date();
      const target = new Date(now);
      target.setUTCHours(hour, 0, 0, 0);

      const targetDay = dayOfWeek;
      const currentDay = now.getUTCDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil < 0) daysUntil += 7;
      if (daysUntil === 0 && target <= now) daysUntil = 7;

      target.setUTCDate(target.getUTCDate() + daysUntil);
      const diffMs = target.getTime() - now.getTime();
      return Math.max(0, diffMs);
    } catch {
      return 0;
    }
  }

  // ────────────────────────────────────────────────────────────
  // 6. REVENUE OPTIMIZATION
  // ────────────────────────────────────────────────────────────

  async optimize(projectId: string): Promise<RevenueOptimization> {
    try {
      const project = await prisma.videoProject.findUnique({
        where: { id: projectId },
        include: { script: true, analytics: true },
      });

      if (!project) {
        return {
          estimatedRevenue: 0,
          optimizations: { titleScore: 0, thumbnailScore: 0, timingScore: 0, affiliateScore: 0, viralScore: 0 },
          recommendations: ['Project not found'],
        };
      }

      const topic = project.topic;
      const title = project.title || topic;
      const scriptContent = project.script?.content || '';
      const hook = project.script?.hook || '';

      const nicheBase = getNicheRpm(topic);
      const predictedViews = project.analytics?.views || 5000;
      const ctr = project.analytics?.ctr || 3.0;
      const retention = project.analytics?.retention || 40;

      const titleLower = title.toLowerCase();
      let titleScore = 40;
      if (titleLower.includes('?')) titleScore += 15;
      if (titleLower.match(/^\d+/)) titleScore += 10;
      if (POWER_WORDS.some(w => titleLower.includes(w))) titleScore += 10;
      if (titleLower.includes('you') || titleLower.includes('your')) titleScore += 8;
      if (title.length >= 30 && title.length <= 60) titleScore += 7;
      titleScore = Math.min(100, Math.max(0, titleScore));

      let thumbnailScore = 50;
      if (ctr >= 8) thumbnailScore = 90;
      else if (ctr >= 5) thumbnailScore = 70;
      else if (ctr >= 3) thumbnailScore = 50;
      else thumbnailScore = 30;

      const timingData = await this.getOptimalUploadTime(project.channelId || '');
      let timingScore = 50;
      const nowHour = new Date().getHours();
      const hourDiff = Math.abs(timingData.hour - nowHour);
      if (hourDiff <= 1) timingScore = 90;
      else if (hourDiff <= 3) timingScore = 70;
      else timingScore = 40;

      const affiliateScore = scriptContent ? this.scoreAffiliateOpportunity(scriptContent, topic) : 30;

      const viralProb = scriptContent ? this.predictViralProbability(scriptContent, title, topic) : 0.3;
      const viralScore = Math.round(viralProb * 100);

      const rpm = nicheBase;
      const viralMultiplier = this.getViralMultiplier(viralProb);
      const estimatedRevenue = Math.round(predictedViews * (rpm / 1000) * viralMultiplier * 100) / 100;

      const recommendations: string[] = [];

      if (titleScore < 60) {
        recommendations.push('Improve title: add numbers, power words, or a question to boost CTR');
      }
      if (thumbnailScore < 60) {
        recommendations.push('Optimize thumbnail: use high-contrast colors, close-up face, and bold text overlay');
      }
      if (timingScore < 60) {
        recommendations.push(`Schedule upload for optimal time: ${timingData.hour}:00 ${timingData.timezone} on day ${timingData.dayOfWeek}`);
      }
      if (affiliateScore >= 30) {
        recommendations.push('Add affiliate links in description and pinned comment to boost revenue');
      } else {
        recommendations.push('Low affiliate opportunity — consider reframing topic toward a commercial angle');
      }
      if (viralProb < 0.4) {
        recommendations.push('Strengthen hook and title to increase viral potential — use curiosity gaps and controversy');
      }
      if (retention < 50) {
        recommendations.push('Add pattern interrupts (questions, surprises) every 30-60s to improve retention');
      }
      if (ctr < 4) {
        recommendations.push('Improve thumbnail and title packaging to increase click-through rate above 4%');
      }
      if (estimatedRevenue < 10) {
        recommendations.push('Consider longer content (8-12 min) or higher-CPM niche angles to increase revenue');
      }

      return {
        estimatedRevenue,
        optimizations: {
          titleScore,
          thumbnailScore,
          timingScore,
          affiliateScore,
          viralScore,
        },
        recommendations,
      };
    } catch (err: any) {
      logger.error(`[MonetizationEngine] optimize failed: ${err.message}`);
      return {
        estimatedRevenue: 0,
        optimizations: { titleScore: 0, thumbnailScore: 0, timingScore: 0, affiliateScore: 0, viralScore: 0 },
        recommendations: ['Error during optimization analysis'],
      };
    }
  }
}

export const monetizationEngine = new MonetizationEngine();
