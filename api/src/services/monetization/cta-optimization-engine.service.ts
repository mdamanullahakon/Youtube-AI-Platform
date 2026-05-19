import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import { extractJsonArray } from '../../utils/parse-ai-response';

export interface CTAVariant {
  text: string;
  style: 'direct' | 'urgency' | 'curiosity' | 'social-proof' | 'fear-of-missing' | 'value-first';
  conversionScore: number;
  emotionalAppeal: number;
  urgencyLevel: number;
  clarity: number;
  placement: 'description-top' | 'description-middle' | 'pinned-comment' | 'end-screen';
  reasoning: string;
}

export interface PinnedCommentScript {
  text: string;
  ctaVariant: string;
  includesAffiliateLink: boolean;
  includesQuestion: boolean;
  estimatedEngagement: number;
}

export class CTAOptimizationEngine {
  async generateCTAVariants(topic: string, productName?: string): Promise<CTAVariant[]> {
    const productContext = productName ? `\nProduct to promote: ${productName}` : '';

    const response = await generateWithAI(`
      Generate 3 YouTube CTA variants for a video about "${topic}"${productContext}

      Each CTA must be a DIFFERENT psychological approach:
      1. "click now" style - Direct, urgent, immediate action
      2. "limited time" style - Scarcity, FOMO, time-sensitive
      3. "hidden truth" style - Curiosity gap, secret revealed

      Score each 0-100:
      - conversionScore: Likelihood of getting clicks
      - emotionalAppeal: Emotional resonance
      - urgencyLevel: Creates immediacy
      - clarity: Easy to understand

      Return JSON array:
      [{
        "text": "the CTA text (max 15 words, conversational tone)",
        "style": "direct" | "urgency" | "curiosity" | "social-proof" | "fear-of-missing" | "value-first",
        "conversionScore": 0-100,
        "emotionalAppeal": 0-100,
        "urgencyLevel": 0-100,
        "clarity": 0-100,
        "placement": "description-top" | "pinned-comment" | "end-screen",
        "reasoning": "why this CTA drives conversions"
      }]

      CTA rules:
      - Use action verbs (Get, Grab, Claim, Unlock, Discover)
      - Create curiosity gap or scarcity
      - Make it about the viewer's benefit
      - Keep under 120 characters
      - Include emoji for higher CTR

      Return ONLY valid JSON array.
    `, 'ollama', { temperature: 0.7 });

    try {
      const parsed = extractJsonArray(response) as any[];
      if (!parsed || parsed.length === 0) return this.getDefaultCTAs(productName);

      return parsed.map((c: any) => ({
        text: (c.text || 'Check this out').substring(0, 120),
        style: c.style || 'direct',
        conversionScore: Math.min(100, Math.max(0, c.conversionScore || 50)),
        emotionalAppeal: Math.min(100, Math.max(0, c.emotionalAppeal || 50)),
        urgencyLevel: Math.min(100, Math.max(0, c.urgencyLevel || 50)),
        clarity: Math.min(100, Math.max(0, c.clarity || 50)),
        placement: c.placement || 'description-top',
        reasoning: c.reasoning || '',
      }));
    } catch {
      return this.getDefaultCTAs(productName);
    }
  }

  async selectBestCTA(variants: CTAVariant[]): Promise<CTAVariant> {
    if (variants.length === 0) return this.getDefaultCTAs()[0];

    const history = await prisma.aBTestResult.findMany({
      where: { testType: 'cta-style', status: 'completed' },
      orderBy: { completedAt: 'desc' },
      take: 10,
    });

    const scored = variants.map(v => {
      let historyBoost = 0;
      for (const h of history) {
        if (h.winner === 'A' && h.variantA.includes(v.text.substring(0, 30))) historyBoost += 10;
        if (h.winner === 'B' && h.variantB.includes(v.text.substring(0, 30))) historyBoost += 10;
      }

      const overallScore = Math.min(100,
        v.conversionScore * 0.35 +
        v.emotionalAppeal * 0.25 +
        v.urgencyLevel * 0.20 +
        v.clarity * 0.20 +
        historyBoost
      );

      return { ...v, conversionScore: overallScore };
    });

    scored.sort((a, b) => b.conversionScore - a.conversionScore);
    return scored[0];
  }

  async generatePinnedComment(ctaText: string, topic: string, productUrl?: string): Promise<PinnedCommentScript> {
    const response = await generateWithAI(`
      Write a YouTube PINNED COMMENT for a video about "${topic}".

      The CTA for this video is: "${ctaText}"
      ${productUrl ? `Link to include: ${productUrl}` : ''}

      The comment must:
      1. Open with a greeting related to the video
      2. Include the CTA naturally
      3. Add a discussion question to drive comment engagement
      4. Max 250 characters

      Return JSON:
      {
        "text": "full comment text",
        "includesAffiliateLink": true/false,
        "includesQuestion": true/false,
        "estimatedEngagement": 0-100
      }

      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.4 });

    try {
      const parsed = JSON.parse(response);
      return {
        text: (parsed.text || ctaText).substring(0, 250),
        ctaVariant: ctaText,
        includesAffiliateLink: parsed.includesAffiliateLink === true,
        includesQuestion: parsed.includesQuestion === true,
        estimatedEngagement: Math.min(100, Math.max(0, parsed.estimatedEngagement || 50)),
      };
    } catch {
      return {
        text: ctaText,
        ctaVariant: ctaText,
        includesAffiliateLink: !!productUrl,
        includesQuestion: true,
        estimatedEngagement: 50,
      };
    }
  }

  async generateEndScreenCTA(videoTitle: string): Promise<string> {
    const response = await generateWithAI(`
      Write an end-screen voiceover script (15 words max) for a YouTube video titled "${videoTitle}".
      This is what the narrator says at the end to drive a conversion (subscribe, click link, buy product).

      Make it:
      - Conversational and natural
      - Create urgency or curiosity
      - Direct viewers to the link in description

      Return ONLY the script text.
    `, 'ollama', { temperature: 0.4 });

    return response.trim().replace(/^["']|["']$/g, '').substring(0, 150) || 'Thanks for watching! Check the link in the description for more.';
  }

  private getDefaultCTAs(productName?: string): CTAVariant[] {
    const name = productName || 'this resource';
    return [
      { text: `🚀 Grab ${name} while the offer lasts →`, style: 'direct', conversionScore: 78, emotionalAppeal: 65, urgencyLevel: 85, clarity: 90, placement: 'description-top', reasoning: 'Direct action with urgency' },
      { text: `⏰ Limited time: ${name} at special price`, style: 'urgency', conversionScore: 82, emotionalAppeal: 70, urgencyLevel: 95, clarity: 85, placement: 'pinned-comment', reasoning: 'Scarcity drives immediate clicks' },
      { text: `🔑 The truth about ${name} they don't want you to know`, style: 'curiosity', conversionScore: 80, emotionalAppeal: 85, urgencyLevel: 50, clarity: 70, placement: 'description-middle', reasoning: 'Curiosity gap compels exploration' },
    ];
  }
}
