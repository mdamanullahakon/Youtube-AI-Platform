import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJson } from '../utils/parse-ai-response';
import type { ChannelAuditReport } from './channel-audit.service';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OptimizerInput {
  auditReport: ChannelAuditReport;
  channelName: string;
  channelDescription: string;
  channelTags: string;
  channelBanner: string;
  channelLogo: string;
  targetNiche: string;
  targetAudience: string;
  competitorInsights?: string;
}

export interface BannerText {
  headline: string;
  subheadline: string;
}

export interface SEOBoost {
  keywordsToTarget: string[];
  hashtagStrategy: string;
}

export interface OptimizationOutput {
  niche_positioning: string;
  optimized_description: string;
  optimized_tags: string[];
  name_suggestions: string[];
  banner_text: BannerText;
  logo_concept: string;
  viral_video_ideas: string[];
  seo_boost: SEOBoost;
  monetization_plan: string;
  transformation_summary: string;
  confidence_score: number;
  before_vs_after: {
    whatWasWrong: string[];
    whatIsFixed: string[];
    expectedImprovement: string;
  };
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class ChannelOptimizerService {
  /**
   * Executes a full channel optimization based on the audit report.
   * The AI auto-generates optimized descriptions, tags, names, banners,
   * logos, content strategy, SEO, and monetization plan.
   */
  async runOptimization(input: OptimizerInput): Promise<OptimizationOutput> {
    const { auditReport, channelName } = input;
    logger.info(`[ChannelOptimizer] Starting optimization for ${channelName} (score=${auditReport.final_score})`);

    // Determine execution mode based on score
    const mode = this.determineMode(auditReport.final_score);
    logger.info(`[ChannelOptimizer] Mode: ${mode}`);

    const prompt = this.buildOptimizerPrompt(input, mode);
    const raw = await generateWithAI(prompt, 'ollama', {
      temperature: 0.4,
      maxTokens: 4096,
    });

    const parsed = extractJson<OptimizationOutput>(raw);
    if (!parsed) {
      logger.warn('[ChannelOptimizer] AI returned unparseable JSON — building degraded output');
      return this.buildFallbackOutput(channelName, mode);
    }

    const validated = this.validateOutput(parsed, channelName);
    logger.info(`[ChannelOptimizer] Optimization complete for ${channelName}: confidence=${validated.confidence_score}`);
    return validated;
  }

  private determineMode(score: number): string {
    if (score < 25) return 'FULL_REBRAND';
    if (score < 40) return 'PARTIAL_REBRAND';
    if (score < 60) return 'AGGRESSIVE_OPTIMIZATION';
    return 'FINE_TUNING';
  }

  private buildOptimizerPrompt(input: OptimizerInput, mode: string): string {
    const { auditReport, channelName, channelDescription, channelTags, channelBanner, channelLogo, targetNiche, targetAudience, competitorInsights } = input;

    return `You are an Autonomous YouTube Growth AI Agent with full authority to optimize, rewrite, and improve a YouTube channel for maximum CTR, retention, and monetization.

You do NOT just suggest improvements — you EXECUTE optimized outputs.

---

## EXECUTION MODE: ${mode}

${mode === 'FULL_REBRAND' ? '🔴 Full rebranding mode activated — score < 25. Complete overhaul required.' :
  mode === 'PARTIAL_REBRAND' ? '🟠 Partial rebranding allowed — score < 40. Significant changes needed.' :
  mode === 'AGGRESSIVE_OPTIMIZATION' ? '🟡 Aggressive optimization — score < 60. Major improvements required.' :
  '🟢 Fine-tuning mode — score >= 60. Polish and optimize.'}

---

## INPUT

**Channel:** ${channelName}
**Description:** ${channelDescription || 'N/A'}
**Tags:** ${channelTags || 'N/A'}
**Banner:** ${channelBanner || 'N/A'}
**Logo:** ${channelLogo || 'N/A'}
**Target Niche:** ${targetNiche}
**Target Audience:** ${targetAudience || 'Not specified'}
${competitorInsights ? `**Competitor Insights:** ${competitorInsights}` : '**Competitor Insights:** Not provided'}

## CHANNEL AUDIT REPORT (JSON)

\`\`\`json
${JSON.stringify(auditReport, null, 2)}
\`\`\`

---

## EXECUTION RULES

- If score < 60 → Aggressive optimization
- If score < 40 → Partial rebranding allowed
- If score < 25 → Full rebranding mode activated
- Always optimize for: CTR (Click Through Rate), Watch Time, Emotional Curiosity, Monetization potential
- Avoid generic outputs
- Use psychological triggers (fear, curiosity, urgency, mystery)
- Be bold and decisive — think like MrBeast + YouTube SEO Expert + Branding Strategist
- Focus on RESULTS, not theory

---

## TASK EXECUTION

### 1. NICHE CORRECTION (if needed)
- Detect actual niche vs target niche from the audit report
- If mismatch: adjust positioning, refocus messaging
- Output a Final Niche Positioning Statement (1-2 sentences)

### 2. CHANNEL DESCRIPTION AUTO-REWRITE
- SEO optimized, keyword-rich, emotion-driven, clear value proposition
- First 2 lines = HIGH CTR hook (must grab attention)
- Include keywords naturally
- Add CTA for subscribe
- Output the full optimized description

### 3. TAGS AUTO-GENERATION
- Generate 15-30 high-ranking tags
- Based on niche, competitors, viral keywords
- Output as an array of tag strings

### 4. CHANNEL NAME OPTIMIZATION
- If current name is weak: suggest 3-5 improved names
- Must match niche, must be memorable, prefer short + powerful
- If name is already strong, suggest 1-2 alternatives for testing

### 5. BANNER TEXT GENERATION
- Clear promise, emotional hook, niche clarity
- Format: headline + subheadline

### 6. LOGO CONCEPT SUGGESTION
- Describe: style, color psychology, visual elements
- One paragraph describing the ideal logo concept

### 7. CONTENT STRATEGY AUTO-FIX
- Generate 5-10 viral video ideas with CTR-optimized titles
- Use curiosity gap, emotional trigger, niche aligned

### 8. SEO BOOST PACK
- Keywords to target
- Hashtag strategy

### 9. MONETIZATION OPTIMIZATION
- Suggest affiliate strategy
- Content monetization angles
- Based on niche and audience

### 10. FINAL AUTO FIX REPORT
- Transformation summary
- Confidence score (0-100)
- BEFORE vs AFTER IMPACT

---

## OUTPUT FORMAT — Return ONLY valid JSON (no markdown fences, no extra text):

{
  "niche_positioning": "string — final niche positioning statement",
  "optimized_description": "string — full SEO-optimized channel description",
  "optimized_tags": ["tag1", "tag2", ... "tag30"],
  "name_suggestions": ["name1", "name2", "name3"],
  "banner_text": {
    "headline": "string",
    "subheadline": "string"
  },
  "logo_concept": "string — one paragraph describing logo",
  "viral_video_ideas": ["idea1", "idea2", ... "idea10"],
  "seo_boost": {
    "keywordsToTarget": ["keyword1", "keyword2"],
    "hashtagStrategy": "string"
  },
  "monetization_plan": "string — monetization strategy",
  "transformation_summary": "string — summary of all changes made",
  "confidence_score": 0-100,
  "before_vs_after": {
    "whatWasWrong": ["issue1", "issue2"],
    "whatIsFixed": ["fix1", "fix2"],
    "expectedImprovement": "string — expected CTR, growth, branding improvement"
  }
}`;
  }

  private validateOutput(output: Partial<OptimizationOutput> | null | undefined, channelName: string): OptimizationOutput {
    if (!output) {
      return this.buildFallbackOutput(channelName, 'AGGRESSIVE_OPTIMIZATION');
    }
    return {
      niche_positioning: output.niche_positioning || `Optimized positioning for ${channelName} based on audit insights`,
      optimized_description: output.optimized_description || `${channelName} — creating the best content in the niche. Subscribe for more!`,
      optimized_tags: output.optimized_tags?.length ? output.optimized_tags : [channelName, 'youtube', 'viral'],
      name_suggestions: output.name_suggestions?.length ? output.name_suggestions : [channelName],
      banner_text: output.banner_text ?? { headline: '', subheadline: '' },
      logo_concept: output.logo_concept || 'Minimalist design with bold colors reflecting the niche',
      viral_video_ideas: output.viral_video_ideas?.length ? output.viral_video_ideas : ['Analyze top-performing content in niche'],
      seo_boost: output.seo_boost ?? { keywordsToTarget: [], hashtagStrategy: '' },
      monetization_plan: output.monetization_plan || 'Monetization strategy pending full channel audit',
      transformation_summary: output.transformation_summary || `Optimization applied to ${channelName}`,
      confidence_score: output.confidence_score ?? 50,
      before_vs_after: output.before_vs_after ?? {
        whatWasWrong: ['Limited data available'],
        whatIsFixed: ['Optimization queued'],
        expectedImprovement: 'Improvement data will be available after implementation',
      },
    };
  }

  private buildFallbackOutput(channelName: string, mode: string): OptimizationOutput {
    return {
      niche_positioning: `${channelName} — focused on delivering high-quality content (AI unavailable for full analysis)`,
      optimized_description: `Welcome to ${channelName}! We create engaging content. Subscribe and join our community!`,
      optimized_tags: [channelName.toLowerCase().replace(/\s+/g, ''), 'youtube', 'viral', 'trending', 'content'],
      name_suggestions: [channelName],
      banner_text: { headline: 'Coming Soon', subheadline: 'Optimized branding pending AI service availability' },
      logo_concept: 'AI unavailable — logo concept generation skipped',
      viral_video_ideas: ['AI unavailable — content strategy generation skipped'],
      seo_boost: { keywordsToTarget: [], hashtagStrategy: 'AI unavailable — SEO generation skipped' },
      monetization_plan: 'AI unavailable — monetization strategy generation skipped',
      transformation_summary: `Optimization for ${channelName} could not be completed (mode: ${mode}). AI service unavailable.`,
      confidence_score: 30,
      before_vs_after: {
        whatWasWrong: ['AI service unavailable for analysis'],
        whatIsFixed: ['No changes applied'],
        expectedImprovement: 'Retry when AI service is available',
      },
    };
  }
}
