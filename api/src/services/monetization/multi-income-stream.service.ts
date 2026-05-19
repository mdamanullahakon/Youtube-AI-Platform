import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import { extractJson, extractJsonArray } from '../../utils/parse-ai-response';
import { SmartAffiliateEngine, AffiliateProduct } from './smart-affiliate-engine.service';

export interface IncomeStream {
  type: 'affiliate' | 'digital-product' | 'saas-upsell';
  name: string;
  description: string;
  price: number;
  url: string;
  commission?: number;
  niche: string[];
  conversionRate?: number;
  monthlyRevenue?: number;
  priority: number;
}

export interface OfferMatch {
  stream: IncomeStream;
  relevanceScore: number;
  placement: 'description' | 'pinned-comment' | 'end-screen' | 'landing-page';
}

const DIGITAL_PRODUCTS: IncomeStream[] = [
  { type: 'digital-product', name: 'Ultimate Resource Bundle', description: 'Curated templates, checklists, and guides', price: 27, url: 'https://gumroad.com/l/resource-bundle', niche: ['business', 'entrepreneurship', 'productivity'], priority: 7 },
  { type: 'digital-product', name: 'AI Tools Masterclass', description: 'Complete guide to leveraging AI in your workflow', price: 47, url: 'https://gumroad.com/l/ai-masterclass', niche: ['AI', 'tech', 'business', 'education'], priority: 9 },
  { type: 'digital-product', name: 'YouTube Growth Blueprint', description: 'Step-by-step system to grow your channel', price: 37, url: 'https://gumroad.com/l/yt-blueprint', niche: ['youtube', 'content creation', 'social media'], priority: 8 },
  { type: 'digital-product', name: 'Finance Freedom Guide', description: 'Proven strategies for financial independence', price: 57, url: 'https://gumroad.com/l/finance-guide', niche: ['finance', 'investing', 'wealth'], priority: 9 },
  { type: 'digital-product', name: 'Productivity System', description: 'Done-with-you productivity framework', price: 17, url: 'https://gumroad.com/l/productivity', niche: ['self-improvement', 'productivity', 'business'], priority: 6 },
];

const SAAS_UPSELLS: IncomeStream[] = [
  { type: 'saas-upsell', name: 'AI YouTube Suite Pro', description: 'Unlimited video generation, priority support, custom branding', price: 49, url: 'https://youraisaas.com/upgrade', commission: 0, niche: ['AI', 'tech', 'youtube'], priority: 10, monthlyRevenue: 49 },
  { type: 'saas-upsell', name: 'Multi-Channel Enterprise', description: 'Manage 5+ channels, team access, advanced analytics', price: 199, url: 'https://youraisaas.com/enterprise', commission: 0, niche: ['business', 'youtube'], priority: 8, monthlyRevenue: 199 },
  { type: 'saas-upsell', name: 'Revenue Accelerator', description: 'Affiliate network, landing pages, conversion tracking', price: 29, url: 'https://youraisaas.com/revenue', commission: 0, niche: ['business', 'monetization'], priority: 9, monthlyRevenue: 29 },
];

export class MultiIncomeStream {
  private affiliateEngine: SmartAffiliateEngine;

  constructor() {
    this.affiliateEngine = new SmartAffiliateEngine();
  }

  async selectBestOffer(topic: string, keywords: string[], niche?: string): Promise<{
    primary: IncomeStream | AffiliateProduct;
    secondary: (IncomeStream | AffiliateProduct)[];
    type: string;
  }> {
    const affiliateProducts = await this.affiliateEngine.selectProductsForVideo(topic, keywords, niche);
    const allOffers: { stream: IncomeStream | AffiliateProduct; score: number; type: string }[] = [];

    for (const ap of affiliateProducts) {
      allOffers.push({ stream: ap, score: ap.priority * 10, type: 'affiliate' });
    }

    for (const dp of DIGITAL_PRODUCTS) {
      let score = 0;
      const topicLower = topic.toLowerCase();
      for (const n of dp.niche) {
        if (topicLower.includes(n)) score += dp.priority * 10;
      }
      for (const kw of keywords) {
        if (dp.niche.some(n => kw.toLowerCase().includes(n))) score += 5;
      }
      if (niche && dp.niche.some(n => niche.toLowerCase().includes(n))) score += dp.priority * 8;
      if (score > 0) allOffers.push({ stream: dp, score, type: 'digital-product' });
    }

    for (const su of SAAS_UPSELLS) {
      let score = 0;
      const topicLower = topic.toLowerCase();
      for (const n of su.niche) {
        if (topicLower.includes(n)) score += su.priority * 8;
      }
      if (score > 0) allOffers.push({ stream: su, score, type: 'saas-upsell' });
    }

    allOffers.sort((a, b) => b.score - a.score);

    const primary = allOffers[0];
    if (!primary) {
      return { primary: affiliateProducts[0], secondary: affiliateProducts.slice(1), type: 'affiliate' };
    }

    return {
      primary: primary.stream,
      secondary: allOffers.slice(1, 4).map(o => o.stream),
      type: primary.type,
    };
  }

  async generateOfferDescription(offer: IncomeStream | AffiliateProduct, topic: string): Promise<string> {
    const productName = 'name' in offer ? offer.name : (offer as AffiliateProduct).name;

    const response = await generateWithAI(`
      Write a compelling 2-sentence offer description for a video about "${topic}".

      Offer: ${productName}
      ${'description' in offer ? `Description: ${offer.description}` : ''}
      ${'commission' in offer ? `Commission: $${offer.commission}` : ''}

      Style: benefit-driven, conversational, creates curiosity
      Must mention what the viewer gains by clicking.

      Return ONLY the 2-sentence description.
    `, 'ollama', { temperature: 0.4 });

    return response.trim().replace(/^["']|["']$/g, '').substring(0, 300) || `Check out ${productName} — it's the perfect complement to what we discussed in this video.`;
  }

  getAllDigitalProducts(): IncomeStream[] {
    return DIGITAL_PRODUCTS;
  }

  getAllSaaSUpsells(): IncomeStream[] {
    return SAAS_UPSELLS;
  }

  async getCombinedRevenueProjection(monthlyViews: number): Promise<{
    affiliateProjection: number;
    digitalProductProjection: number;
    saasProjection: number;
    totalProjection: number;
  }> {
    const affiliateProjection = (monthlyViews / 1000) * 8 * 0.15;
    const digitalProductProjection = (monthlyViews / 10000) * 37 * 0.05;
    const saasProjection = SAAS_UPSELLS.reduce((s, su) => s + (su.monthlyRevenue || 0), 0) * 0.5;

    return {
      affiliateProjection: Math.round(affiliateProjection * 100) / 100,
      digitalProductProjection: Math.round(digitalProductProjection * 100) / 100,
      saasProjection: Math.round(saasProjection * 100) / 100,
      totalProjection: Math.round((affiliateProjection + digitalProductProjection + saasProjection) * 100) / 100,
    };
  }
}
