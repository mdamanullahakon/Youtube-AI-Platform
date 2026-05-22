import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJson } from '../utils/parse-ai-response';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NicheAnalysis {
  actualNiche: string;
  expectedNiche: string;
  matchScore: number;
  mismatchReasons: string[];
  nicheClarityLevel: 'Clear' | 'Confused' | 'Mixed';
}

export interface BrandingAnalysis {
  brandingScore: number;
  issues: string[];
  emotionalImpactLevel: 'Low' | 'Medium' | 'High';
}

export interface SEOAnalysis {
  seoScore: number;
  missingKeywords: string[];
  keywordOpportunities: string[];
}

export interface ContentStrategyAnalysis {
  contentStrategyScore: number;
  viralPotentialRating: string;
  contentGaps: string[];
}

export interface CTRRetentionAnalysis {
  ctrScore: number;
  retentionScore: number;
  keyDropOffRisks: string[];
}

export interface CompetitorAnalysis {
  weaknessVsCompetitors: string[];
  opportunitiesToOutperform: string[];
}

export interface ActionPlan {
  quick_fixes: string[];
  high_impact_fixes: string[];
  long_term_strategy: string[];
  suggestedDescription: string;
  suggestedTags: string[];
  suggestedChannelName: string;
  bannerTextSuggestion: string;
  logoConceptSuggestion: string;
}

export interface ChannelAuditReport {
  niche_analysis: NicheAnalysis;
  branding: BrandingAnalysis;
  seo: SEOAnalysis;
  content_strategy: ContentStrategyAnalysis;
  ctr_retention: CTRRetentionAnalysis;
  competitor_analysis: CompetitorAnalysis;
  action_plan: ActionPlan;
  final_score: number;
  summary: string;
}

export interface AuditInput {
  channelId: string;
  expectedNiche?: string;
  competitorChannelIds?: string[];
  channelDescription?: string;
  channelTags?: string;
  channelBannerUrl?: string;
  channelLogoUrl?: string;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class ChannelAuditService {
  /**
   * Performs a full channel audit using AI analysis.
   * Fetches channel metadata, video performance data, and feeds it to the
   * Channel Growth Strategist AI prompt to produce a structured report.
   */
  async runAudit(input: AuditInput): Promise<ChannelAuditReport> {
    const { channelId, expectedNiche, competitorChannelIds } = input;
    logger.info(`[ChannelAudit] Starting audit for channel ${channelId}`);

    // ── Step 1: Fetch channel data ────────────────────────────
    const channel = await prisma.youTubeAccount.findFirst({
      where: { channelId },
    });

    if (!channel) {
      throw new Error(`YouTube channel ${channelId} not found`);
    }

    const channelMetrics = await prisma.channelMetrics.findFirst({
      where: { channelId },
    });

    // Fetch top 10 published videos with analytics
    const topVideos = await prisma.videoProject.findMany({
      where: { channelId, status: 'published' },
      include: {
        analytics: true,
        uploadHistory: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // ── Step 2: Build channel data for the AI prompt ──────────
    const channelInfo = this.buildChannelInfo(channel, channelMetrics, expectedNiche, input);
    const topVideosInfo = this.buildTopVideosInfo(topVideos);

    // ── Step 3: Build and send the AI prompt ──────────────────
    const report = await this.callAuditAI(channelInfo, topVideosInfo, competitorChannelIds);

    // ── Step 4: Validate the report has all required fields ───
    const validated = this.validateReport(report, String(channelInfo.channelName ?? 'Unknown Channel'));

    logger.info(`[ChannelAudit] Audit complete for ${channelId}: score=${validated.final_score}`);

    return validated;
  }

  private buildChannelInfo(
    channel: any,
    channelMetrics: any,
    expectedNiche?: string,
    inputOverrides?: Partial<AuditInput>,
  ): Record<string, unknown> {
    return {
      channelName: channel.channelTitle || 'Unknown Channel',
      channelDescription: inputOverrides?.channelDescription || '',
      channelTags: inputOverrides?.channelTags || channel.niche || 'general',
      channelBanner: inputOverrides?.channelBannerUrl || channel.channelAvatar || 'No banner available',
      channelLogo: inputOverrides?.channelLogoUrl || channel.channelAvatar || 'No logo available',
      channelNiche: channel.niche || expectedNiche || 'generic',
      expectedNiche: expectedNiche || channel.niche || 'generic',
      targetAudience: channelMetrics?.topNiche || 'Not specified',
      subscribers: channelMetrics?.subscribers || 0,
      totalViews: channelMetrics?.totalViews || 0,
      totalVideos: channelMetrics?.totalVideos || 0,
      avgCTR: channelMetrics?.avgCTR || 0,
      avgRetention: channelMetrics?.avgRetention || 0,
      subscriberGrowth: channelMetrics?.subscriberGrowth || 0,
      monthlyViews: channelMetrics?.monthlyViews || 0,
      monthlyWatchHours: channelMetrics?.monthlyWatchHours || 0,
      estimatedRPM: channelMetrics?.estimatedRPM || 0,
      estimatedCPM: channelMetrics?.estimatedCPM || 0,
      estimatedEarnings: channelMetrics?.estimatedEarnings || 0,
    };
  }

  private buildTopVideosInfo(videos: any[]): Record<string, unknown>[] {
    return videos.slice(0, 10).map((v, i) => ({
      position: i + 1,
      title: v.title || v.topic,
      views: v.analytics?.views || 0,
      likes: v.analytics?.likes || 0,
      comments: v.analytics?.comments || 0,
      ctr: v.analytics?.ctr || 0,
      retention: v.analytics?.retention || 0,
      watchTime: v.analytics?.watchTime || 0,
      publishedAt: v.uploadHistory?.publishedAt?.toISOString() || v.createdAt?.toISOString() || 'N/A',
      status: v.status,
    }));
  }

  private async callAuditAI(
    channelInfo: Record<string, unknown>,
    topVideos: Record<string, unknown>[],
    competitorChannelIds?: string[],
  ): Promise<ChannelAuditReport> {
    const competitorInfo = competitorChannelIds?.length
      ? await this.fetchCompetitorInfo(competitorChannelIds)
      : null;

    const prompt = this.buildAuditPrompt(channelInfo, topVideos, competitorInfo);

    const raw = await generateWithAI(prompt, 'ollama', {
      temperature: 0.3,
      maxTokens: 4096,
    });

    const parsed = extractJson<ChannelAuditReport>(raw);
    if (!parsed) {
      logger.warn('[ChannelAudit] AI returned unparseable JSON — falling back to degraded report');
      return this.buildFallbackReport(channelInfo.channelName as string);
    }

    return parsed;
  }

  private buildAuditPrompt(
    channelInfo: Record<string, unknown>,
    topVideos: Record<string, unknown>[],
    competitorInfo: Record<string, unknown>[] | null,
  ): string {
    const videosTable = topVideos.map(v =>
      `  ${v.position}. "${v.title}" | Views: ${v.views} | CTR: ${v.ctr}% | Retention: ${v.retention}%`
    ).join('\n');

    const competitorSection = competitorInfo?.length
      ? `\nCOMPETITOR CHANNELS:\n${competitorInfo.map(c => JSON.stringify(c)).join('\n')}`
      : '\nCOMPETITOR CHANNELS: Not provided';

    return `You are an elite YouTube Channel Growth Strategist, Branding Expert, and Viral Content Analyst AI.

Your job is to deeply analyze this YouTube channel and produce a complete Channel Audit Report focused on branding, niche alignment, and growth optimization.

---

CHANNEL INFORMATION:
- Channel Name: ${channelInfo.channelName}
- Channel Description: ${channelInfo.channelDescription}
- Channel Tags / Keywords: ${channelInfo.channelTags}
- Channel Banner: ${channelInfo.channelBanner}
- Channel Logo: ${channelInfo.channelLogo}
- Channel Niche (current): ${channelInfo.channelNiche}
- Expected Niche: ${channelInfo.expectedNiche}
- Target Audience: ${channelInfo.targetAudience}
- Subscribers: ${channelInfo.subscribers}
- Total Views: ${channelInfo.totalViews}
- Total Videos: ${channelInfo.totalVideos}
- Avg CTR: ${channelInfo.avgCTR}%
- Avg Retention: ${channelInfo.avgRetention}%
- Subscriber Growth (30d): ${channelInfo.subscriberGrowth}
- Monthly Views: ${channelInfo.monthlyViews}
- Monthly Watch Hours: ${channelInfo.monthlyWatchHours}
- Estimated RPM: $${channelInfo.estimatedRPM}
- Estimated CPM: $${channelInfo.estimatedCPM}
- Estimated Monthly Earnings: $${channelInfo.estimatedEarnings}

TOP 10 VIDEOS:
${videosTable}
${competitorSection}

---

TASK:

Perform a full deep analysis across the following 7 layers:

### 1. NICHE ALIGNMENT SCORE
- Determine actual niche of the channel
- Compare with expected niche
- Output:
  - Match Score (0–100)
  - Mismatch reasons
  - Niche clarity level (Clear / Confused / Mixed)

### 2. CHANNEL BRANDING ANALYSIS
Analyze:
- Channel Name relevance to niche
- Logo visual alignment (does it reflect niche?)
- Banner messaging clarity (does it communicate value?)

Output:
- Branding Score (0–100)
- Issues (if generic / misleading / low impact)
- Emotional impact level (Low / Medium / High)

### 3. SEO & DISCOVERABILITY AUDIT
Analyze:
- Description keyword optimization
- Tags relevance & ranking potential
- Searchability of channel

Output:
- SEO Score (0–100)
- Missing keywords
- Keyword opportunities

### 4. CONTENT STRATEGY ANALYSIS
Analyze:
- Video titles (clickbait vs curiosity vs boring)
- Content consistency
- Alignment with niche

Output:
- Content Strategy Score (0–100)
- Viral potential rating
- Content gaps

### 5. CTR & RETENTION OPTIMIZATION CHECK
If data available:
- CTR analysis
- Retention patterns

If not:
- Predict CTR potential based on titles

Output:
- CTR Score
- Retention Score
- Key drop-off risks

### 6. COMPETITOR COMPARISON (if provided)
- Compare branding
- Compare titles
- Compare positioning

Output:
- Weakness vs competitors
- Opportunities to outperform

### 7. ACTIONABLE IMPROVEMENT PLAN (MOST IMPORTANT)

Provide:

🔥 Quick Fixes (can be done in 1 hour)
🔥 High Impact Fixes (1–2 days)
🔥 Growth Strategy (long-term)

### CHANNEL HEALTH STATUS
- 🟢 Optimized
- 🟡 Needs Improvement
- 🔴 Critical Issues

Explain WHY.

---

IMPORTANT RULES:
- Be brutally honest (no sugarcoating)
- Think like a viral YouTube strategist
- Prioritize growth, CTR, and retention
- Always suggest improvements, not just analysis
- Focus on monetization potential

---

OUTPUT FORMAT — Return ONLY valid JSON (no markdown fences, no extra text):

{
  "niche_analysis": {
    "actualNiche": "string",
    "expectedNiche": "string",
    "matchScore": 0-100,
    "mismatchReasons": ["string"],
    "nicheClarityLevel": "Clear|Confused|Mixed"
  },
  "branding": {
    "brandingScore": 0-100,
    "issues": ["string"],
    "emotionalImpactLevel": "Low|Medium|High"
  },
  "seo": {
    "seoScore": 0-100,
    "missingKeywords": ["string"],
    "keywordOpportunities": ["string"]
  },
  "content_strategy": {
    "contentStrategyScore": 0-100,
    "viralPotentialRating": "string",
    "contentGaps": ["string"]
  },
  "ctr_retention": {
    "ctrScore": 0-100,
    "retentionScore": 0-100,
    "keyDropOffRisks": ["string"]
  },
  "competitor_analysis": {
    "weaknessVsCompetitors": ["string"],
    "opportunitiesToOutperform": ["string"]
  },
  "action_plan": {
    "quick_fixes": ["string"],
    "high_impact_fixes": ["string"],
    "long_term_strategy": ["string"],
    "suggestedDescription": "string",
    "suggestedTags": ["string"],
    "suggestedChannelName": "string",
    "bannerTextSuggestion": "string",
    "logoConceptSuggestion": "string"
  },
  "final_score": 0-100,
  "summary": "clear strategic summary"
}`;
  }

  private async fetchCompetitorInfo(channelIds: string[]): Promise<Record<string, unknown>[]> {
    const competitors = await prisma.youTubeAccount.findMany({
      where: { channelId: { in: channelIds } },
    });

    const results: Record<string, unknown>[] = [];
    for (const comp of competitors) {
      const metrics = await prisma.channelMetrics.findFirst({
        where: { channelId: comp.channelId },
      });
      const videos = await prisma.videoProject.findMany({
        where: { channelId: comp.channelId, status: 'published' },
        include: { analytics: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });

      results.push({
        channelName: comp.channelTitle || 'Unknown',
        subscribers: metrics?.subscribers || 0,
        totalViews: metrics?.totalViews || 0,
        avgCTR: metrics?.avgCTR || 0,
        avgRetention: metrics?.avgRetention || 0,
        niche: comp.niche || 'general',
        topVideoTitles: videos.map(v => v.title || v.topic),
      });
    }
    return results;
  }

  private validateReport(report: Partial<ChannelAuditReport>, channelName: string): ChannelAuditReport {
    return {
      niche_analysis: report.niche_analysis ?? {
        actualNiche: 'Unknown',
        expectedNiche: 'Unknown',
        matchScore: 50,
        mismatchReasons: ['Insufficient data to determine niche alignment'],
        nicheClarityLevel: 'Mixed',
      },
      branding: report.branding ?? {
        brandingScore: 50,
        issues: ['Unable to analyze branding — data incomplete'],
        emotionalImpactLevel: 'Medium',
      },
      seo: report.seo ?? {
        seoScore: 50,
        missingKeywords: ['Unable to determine — data incomplete'],
        keywordOpportunities: ['Unable to determine — data incomplete'],
      },
      content_strategy: report.content_strategy ?? {
        contentStrategyScore: 50,
        viralPotentialRating: 'Unknown',
        contentGaps: ['Unable to determine — data incomplete'],
      },
      ctr_retention: report.ctr_retention ?? {
        ctrScore: 50,
        retentionScore: 50,
        keyDropOffRisks: ['Unable to determine — data incomplete'],
      },
      competitor_analysis: report.competitor_analysis ?? {
        weaknessVsCompetitors: ['No competitor data available'],
        opportunitiesToOutperform: ['No competitor data available'],
      },
      action_plan: report.action_plan ?? {
        quick_fixes: ['Connect channel to get full audit'],
        high_impact_fixes: ['Upload more content to gather analytics'],
        long_term_strategy: ['Consistent uploads + analyze YouTube Studio data'],
        suggestedDescription: 'N/A — connect YouTube account for full suggestions',
        suggestedTags: ['N/A'],
        suggestedChannelName: 'N/A',
        bannerTextSuggestion: 'N/A',
        logoConceptSuggestion: 'N/A',
      },
      final_score: report.final_score ?? 50,
      summary: report.summary ?? `Channel audit for ${channelName} completed with limited data. Connect YouTube account and publish videos for a comprehensive analysis.`,
    };
  }

  private buildFallbackReport(channelName: string): ChannelAuditReport {
    return {
      niche_analysis: {
        actualNiche: 'Unknown (AI unavailable)',
        expectedNiche: 'Unknown',
        matchScore: 50,
        mismatchReasons: ['AI provider unavailable — could not analyze niche alignment'],
        nicheClarityLevel: 'Mixed',
      },
      branding: {
        brandingScore: 50,
        issues: ['AI unavailable — branding analysis skipped'],
        emotionalImpactLevel: 'Medium',
      },
      seo: {
        seoScore: 50,
        missingKeywords: ['AI unavailable — SEO analysis skipped'],
        keywordOpportunities: ['AI unavailable — keyword analysis skipped'],
      },
      content_strategy: {
        contentStrategyScore: 50,
        viralPotentialRating: 'Unknown (AI unavailable)',
        contentGaps: ['AI unavailable — content gap analysis skipped'],
      },
      ctr_retention: {
        ctrScore: 50,
        retentionScore: 50,
        keyDropOffRisks: ['AI unavailable — CTR/retention analysis skipped'],
      },
      competitor_analysis: {
        weaknessVsCompetitors: ['AI unavailable — competitor analysis skipped'],
        opportunitiesToOutperform: ['AI unavailable — opportunity analysis skipped'],
      },
      action_plan: {
        quick_fixes: ['Check AI service configuration and retry'],
        high_impact_fixes: ['Ensure Ollama or Gemini API key is configured'],
        long_term_strategy: ['Schedule regular audits when AI service is available'],
        suggestedDescription: 'AI unavailable — retry when service is back',
        suggestedTags: ['AI unavailable'],
        suggestedChannelName: 'AI unavailable',
        bannerTextSuggestion: 'AI unavailable',
        logoConceptSuggestion: 'AI unavailable',
      },
      final_score: 50,
      summary: `Audit for ${channelName} could not be completed because AI services are unavailable. Please check your AI provider configuration and try again.`,
    };
  }
}
