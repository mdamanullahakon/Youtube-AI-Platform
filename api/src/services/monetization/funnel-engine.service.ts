import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import { extractJson } from '../../utils/parse-ai-response';
import { SmartAffiliateEngine, AffiliateProduct, AffiliateLinkWithTracking } from './smart-affiliate-engine.service';

export interface FunnelStage {
  name: string;
  url: string;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionRate: number;
}

export interface ConversionFunnel {
  projectId: string;
  videoId: string;
  stages: FunnelStage[];
  overallConversionRate: number;
  totalRevenue: number;
}

export interface LandingPageConfig {
  projectId: string;
  headline: string;
  subheadline: string;
  emotionalHook: string;
  offerDescription: string;
  ctaText: string;
  ctaUrl: string;
  productName: string;
  productImage?: string;
  testimonials?: string[];
  urgencyText?: string;
  guaranteeText?: string;
}

export class FunnelEngine {
  private affiliateEngine: SmartAffiliateEngine;

  constructor() {
    this.affiliateEngine = new SmartAffiliateEngine();
  }

  async generateLandingPage(config: LandingPageConfig): Promise<string> {
    const testimonialHtml = config.testimonials?.length
      ? config.testimonials.map(t => `
        <div class="testimonial">
          <p>"${t}"</p>
        </div>`).join('\n')
      : '';

    const urgencyHtml = config.urgencyText
      ? `<div class="urgency-banner">⏰ ${config.urgencyText}</div>`
      : '';

    const guaranteeHtml = config.guaranteeText
      ? `<div class="guarantee">✅ ${config.guaranteeText}</div>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${config.headline}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #fff; line-height: 1.6; }
    .container { max-width: 800px; margin: 0 auto; padding: 40px 20px; }
    .hero { text-align: center; padding: 60px 0 40px; }
    .hero h1 { font-size: 2.5em; font-weight: 800; margin-bottom: 20px; background: linear-gradient(135deg, #ff6b35, #ffd700); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero .subheadline { font-size: 1.2em; color: #aaa; margin-bottom: 30px; }
    .hero .hook { font-size: 1.1em; color: #ff6b35; font-style: italic; margin-bottom: 30px; }
    .cta-button { display: inline-block; padding: 18px 50px; font-size: 1.3em; font-weight: 700; color: #fff; background: linear-gradient(135deg, #ff6b35, #e55a2b); border-radius: 50px; text-decoration: none; transition: transform 0.2s, box-shadow 0.2s; box-shadow: 0 4px 20px rgba(255, 107, 53, 0.4); }
    .cta-button:hover { transform: translateY(-2px); box-shadow: 0 6px 30px rgba(255, 107, 53, 0.6); }
    .offer-card { background: #1a1a1a; border-radius: 16px; padding: 40px; margin: 40px 0; border: 1px solid #333; }
    .offer-card h2 { font-size: 1.5em; margin-bottom: 20px; color: #ffd700; }
    .offer-card p { color: #ccc; margin-bottom: 15px; }
    .urgency-banner { background: linear-gradient(135deg, #ff4444, #cc0000); text-align: center; padding: 15px; border-radius: 8px; font-weight: 700; margin: 20px 0; }
    .guarantee { text-align: center; padding: 20px; color: #4caf50; font-weight: 600; }
    .testimonial { background: #222; border-radius: 12px; padding: 20px; margin: 15px 0; border-left: 4px solid #ffd700; }
    .testimonial p { color: #ddd; font-style: italic; }
    .footer { text-align: center; padding: 40px 0; color: #666; font-size: 0.9em; }
    @media (max-width: 600px) {
      .hero h1 { font-size: 1.8em; }
      .cta-button { padding: 15px 30px; font-size: 1.1em; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="hero">
      <h1>${config.headline}</h1>
      <p class="subheadline">${config.subheadline}</p>
      <p class="hook">${config.emotionalHook}</p>
      <a href="${config.ctaUrl}" class="cta-button" target="_blank" rel="noopener">${config.ctaText}</a>
    </div>

    ${urgencyHtml}

    <div class="offer-card">
      <h2>${config.productName}</h2>
      <p>${config.offerDescription}</p>
      <div style="text-align:center; margin-top: 20px;">
        <a href="${config.ctaUrl}" class="cta-button" target="_blank" rel="noopener">${config.ctaText}</a>
      </div>
    </div>

    ${guaranteeHtml}

    ${testimonialHtml ? `<div><h2 style="text-align:center; margin: 40px 0 20px;">What Others Say</h2>${testimonialHtml}</div>` : ''}

    <div class="footer">
      <p>This page contains affiliate links. I may earn a commission at no extra cost to you.</p>
    </div>
  </div>
</body>
</html>`;

    return html;
  }

  async buildVideoFunnel(projectId: string, videoId: string, topic: string, keywords: string[], niche?: string): Promise<{
    landingPageHtml: string;
    funnel: ConversionFunnel;
    funnelUrl: string;
  }> {
    const products = await this.affiliateEngine.selectProductsForVideo(topic, keywords, niche);
    const topProduct = products[0];

    const funnelUrl = `/funnel/${projectId}`;

    const response = await generateWithAI(`
      Generate content for a conversion landing page about "${topic}".

      Product to promote: ${topProduct.name} - ${topProduct.description}

      Return JSON:
      {
        "headline": "powerful benefit-driven headline (max 12 words)",
        "subheadline": "supporting value proposition (max 20 words)",
        "emotionalHook": "emotional trigger sentence that creates desire (max 25 words)",
        "offerDescription": "compelling description of the offer (2-3 sentences)",
        "urgencyText": "optional scarcity/urgency line (or empty string)",
        "guaranteeText": "optional guarantee to reduce risk (or empty string)",
        "testimonialIdeas": ["2-3 short social proof statements"]
      }

      Copywriting rules:
      - Headline must promise a transformation or result
      - Emotional hook must tap into fear, greed, curiosity, or aspiration
      - CTA should create urgency or FOMO
      - Keep language simple, benefit-focused, conversational
      - Focus on what the user GAINS

      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.5 });

    let config: LandingPageConfig;
    try {
      const parsed = extractJson(response) as any;
      config = {
        projectId,
        headline: parsed.headline || `Get The Best ${topProduct.name} Deal`,
        subheadline: parsed.subheadline || `Thousands trust ${topProduct.name} for their needs`,
        emotionalHook: parsed.emotionalHook || `Don't miss out on this game-changing opportunity`,
        offerDescription: parsed.offerDescription || `${topProduct.name} helps you achieve more with less effort. Join millions of satisfied users today.`,
        ctaText: `Claim Your ${topProduct.name} Offer →`,
        ctaUrl: `${topProduct.url}?utm_source=youtube&utm_medium=landing_page&utm_campaign=${projectId}`,
        productName: topProduct.name,
        testimonials: Array.isArray(parsed.testimonialIdeas) ? parsed.testimonialIdeas.slice(0, 3) : [],
        urgencyText: parsed.urgencyText || '',
        guaranteeText: parsed.guaranteeText || '30-day money-back guarantee. No questions asked.',
      };
    } catch {
      config = {
        projectId,
        headline: `Transform Your Results With ${topProduct.name}`,
        subheadline: `The #1 solution trusted by thousands worldwide`,
        emotionalHook: `What if you could achieve more in less time?`,
        offerDescription: `${topProduct.name} provides everything you need to succeed. Start your journey today.`,
        ctaText: `Get ${topProduct.name} Now →`,
        ctaUrl: `${topProduct.url}?utm_source=youtube&utm_medium=landing_page&utm_campaign=${projectId}`,
        productName: topProduct.name,
        urgencyText: 'Limited time offer — prices may increase soon',
        guaranteeText: '30-day money-back guarantee. No questions asked.',
      };
    }

    const landingPageHtml = await this.generateLandingPage(config);

    const funnel: ConversionFunnel = {
      projectId,
      videoId,
      stages: [
        { name: 'video-view', url: `https://youtube.com/watch?v=${videoId}`, impressions: 0, clicks: 0, conversions: 0, conversionRate: 0 },
        { name: 'description-link', url: funnelUrl, impressions: 0, clicks: 0, conversions: 0, conversionRate: 0 },
        { name: 'landing-page', url: config.ctaUrl, impressions: 0, clicks: 0, conversions: 0, conversionRate: 0 },
        { name: 'conversion', url: config.ctaUrl, impressions: 0, clicks: 0, conversions: 0, conversionRate: 0 },
      ],
      overallConversionRate: 0,
      totalRevenue: 0,
    };

    await prisma.monetizationConversionFunnel.upsert({
      where: { projectId },
      update: {
        videoId,
        landingPageHtml,
        funnelUrl,
        stages: funnel.stages as any,
        overallConversionRate: 0,
        totalRevenue: 0,
      },
      create: {
        projectId,
        videoId,
        landingPageHtml,
        funnelUrl,
        stages: funnel.stages as any,
        overallConversionRate: 0,
        totalRevenue: 0,
      },
    });

    return { landingPageHtml, funnel, funnelUrl };
  }

  async recordFunnelAction(projectId: string, stage: string): Promise<void> {
    const funnel = await prisma.monetizationConversionFunnel.findUnique({
      where: { projectId },
    });

    if (!funnel) return;

    const stages = (funnel.stages as any[]) as FunnelStage[];
    const stageIndex = stages.findIndex(s => s.name === stage);
    if (stageIndex === -1) return;

    stages[stageIndex].impressions += 1;

    const videoStage = stages.find(s => s.name === 'video-view');
    const conversionStage = stages.find(s => s.name === 'conversion');
    if (videoStage && videoStage.impressions > 0 && conversionStage) {
      funnel.overallConversionRate = (conversionStage.conversions / videoStage.impressions) * 100;
    }

    await prisma.monetizationConversionFunnel.update({
      where: { projectId },
      data: { stages: stages as any, overallConversionRate: funnel.overallConversionRate },
    });
  }

  async recordFunnelClick(projectId: string, stage: string): Promise<void> {
    const funnel = await prisma.monetizationConversionFunnel.findUnique({
      where: { projectId },
    });

    if (!funnel) return;

    const stages = (funnel.stages as any[]) as FunnelStage[];
    const stageIndex = stages.findIndex(s => s.name === stage);
    if (stageIndex === -1) return;

    stages[stageIndex].clicks += 1;

    const prevStage = stageIndex > 0 ? stages[stageIndex - 1] : null;
    if (prevStage && prevStage.impressions > 0) {
      stages[stageIndex].conversionRate = (stages[stageIndex].clicks / prevStage.impressions) * 100;
    }

    await prisma.monetizationConversionFunnel.update({
      where: { projectId },
      data: { stages: stages as any },
    });
  }

  async recordFunnelConversion(projectId: string, revenue: number): Promise<void> {
    const funnel = await prisma.monetizationConversionFunnel.findUnique({
      where: { projectId },
    });

    if (!funnel) return;

    const stages = (funnel.stages as any[]) as FunnelStage[];
    const conversionStage = stages.find(s => s.name === 'conversion');
    if (conversionStage) {
      conversionStage.conversions += 1;
    }

    funnel.totalRevenue += revenue;

    const videoStage = stages.find(s => s.name === 'video-view');
    if (videoStage && videoStage.impressions > 0 && conversionStage) {
      funnel.overallConversionRate = (conversionStage.conversions / videoStage.impressions) * 100;
    }

    await prisma.monetizationConversionFunnel.update({
      where: { projectId },
      data: { stages: stages as any, totalRevenue: funnel.totalRevenue, overallConversionRate: funnel.overallConversionRate },
    });
  }

  async getFunnelAnalytics(projectId: string): Promise<ConversionFunnel | null> {
    const funnel = await prisma.monetizationConversionFunnel.findUnique({
      where: { projectId },
    });

    if (!funnel) return null;

    return {
      projectId,
      videoId: funnel.videoId,
      stages: funnel.stages as any,
      overallConversionRate: funnel.overallConversionRate,
      totalRevenue: funnel.totalRevenue,
    };
  }

  async getLandingPageHtml(projectId: string): Promise<string | null> {
    const funnel = await prisma.monetizationConversionFunnel.findUnique({
      where: { projectId },
    });

    return funnel?.landingPageHtml || null;
  }
}
