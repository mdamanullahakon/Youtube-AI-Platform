import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import { extractJsonArray, extractJson } from '../../utils/parse-ai-response';

export interface AffiliateProduct {
  id: string;
  name: string;
  url: string;
  commission: number;
  niche: string[];
  keywords: string[];
  priority: number;
  type: 'physical' | 'digital' | 'service' | 'software';
  description: string;
}

export interface AffiliateLinkWithTracking {
  productId: string;
  productName: string;
  affiliateUrl: string;
  utmUrl: string;
  commission: number;
  placement: 'description-top3' | 'description-bottom' | 'pinned-comment';
}

export interface ConversionRecord {
  productId: string;
  projectId: string;
  videoId: string;
  clicks: number;
  conversions: number;
  revenue: number;
  conversionRate: number;
}

const AFFILIATE_CATALOG: AffiliateProduct[] = [
  { id: 'vpn-nord', name: 'NordVPN', url: 'https://go.nordvpn.net/aff_c', commission: 8.00, niche: ['tech', 'privacy', 'security', 'AI'], keywords: ['vpn', 'privacy', 'security', 'browser', 'internet'], priority: 10, type: 'service', description: 'Premium VPN service for online privacy' },
  { id: 'vpn-surfshark', name: 'Surfshark', url: 'https://surfshark.com/deal', commission: 7.50, niche: ['tech', 'privacy'], keywords: ['vpn', 'privacy', 'security'], priority: 8, type: 'service', description: 'Budget-friendly VPN solution' },
  { id: 'skillshare', name: 'Skillshare', url: 'https://skillshare.eqcm.net', commission: 5.00, niche: ['education', 'AI', 'business', 'creative'], keywords: ['learn', 'course', 'skill', 'education', 'tutorial', 'class'], priority: 7, type: 'service', description: 'Online learning platform with thousands of classes' },
  { id: 'betterhelp', name: 'BetterHelp', url: 'https://betterhelp.9k9j.com', commission: 10.00, niche: ['health', 'psychology', 'self-improvement'], keywords: ['therapy', 'mental health', 'anxiety', 'depression', 'counseling', 'wellness'], priority: 9, type: 'service', description: 'Online therapy platform with licensed professionals' },
  { id: 'shopify', name: 'Shopify', url: 'https://shopify.pxf.io', commission: 7.00, niche: ['business', 'entrepreneurship', 'finance'], keywords: ['store', 'ecommerce', 'sell', 'business', 'shop', 'entrepreneur'], priority: 9, type: 'software', description: 'All-in-one ecommerce platform to start your online store' },
  { id: 'bluehost', name: 'Bluehost', url: 'https://bluehost.sjv.io', commission: 6.00, niche: ['tech', 'business'], keywords: ['hosting', 'website', 'domain', 'wordpress', 'web'], priority: 8, type: 'service', description: 'Web hosting provider trusted by millions' },
  { id: 'masterclass', name: 'MasterClass', url: 'https://masterclass.7eer.net', commission: 6.00, niche: ['education', 'creative', 'business'], keywords: ['masterclass', 'learn from', 'expert', 'class', 'course'], priority: 7, type: 'service', description: 'Online classes from world-renowned experts' },
  { id: 'audible', name: 'Audible', url: 'https://audible.8n5.net', commission: 5.00, niche: ['entertainment', 'education', 'self-improvement'], keywords: ['audiobook', 'book', 'listen', 'reading', 'story'], priority: 7, type: 'service', description: 'Premium audiobook and podcast platform' },
  { id: 'fiverr', name: 'Fiverr', url: 'https://fiverr.ovh.net', commission: 4.00, niche: ['business', 'tech', 'creative'], keywords: ['freelance', 'hire', 'service', 'design', 'writing', 'video'], priority: 6, type: 'service', description: 'Global freelance marketplace for digital services' },
  { id: 'hellofresh', name: 'HelloFresh', url: 'https://hellofresh.58ei.net', commission: 5.00, niche: ['lifestyle', 'food', 'health'], keywords: ['meal kit', 'cooking', 'recipe', 'food', 'dinner'], priority: 6, type: 'service', description: 'Meal kit delivery service with fresh ingredients' },
  { id: 'teachable', name: 'Teachable', url: 'https://teachable.sjv.io', commission: 6.00, niche: ['education', 'business'], keywords: ['course', 'teach', 'create course', 'online course', 'learning platform'], priority: 7, type: 'software', description: 'Platform to create and sell online courses' },
  { id: 'canva', name: 'Canva Pro', url: 'https://canva.9k9j.com', commission: 5.00, niche: ['creative', 'tech', 'business'], keywords: ['design', 'graphic design', 'template', 'presentation', 'social media'], priority: 7, type: 'software', description: 'All-in-one design platform for creators' },
];

export class SmartAffiliateEngine {
  async selectProductsForVideo(topic: string, keywords: string[], niche?: string): Promise<AffiliateProduct[]> {
    const topicLower = topic.toLowerCase();
    const topicWords = topicLower.split(/\s+/);

    const scored = AFFILIATE_CATALOG.map(product => {
      let score = 0;

      for (const kw of topicWords) {
        if (product.keywords.some(pk => kw.includes(pk) || pk.includes(kw))) score += 15;
        if (product.niche.some(n => topicLower.includes(n))) score += 20;
      }

      for (const keyword of keywords) {
        const kw = keyword.toLowerCase();
        if (product.keywords.some(pk => kw.includes(pk))) score += 10;
        if (product.niche.some(n => kw.includes(n))) score += 10;
      }

      if (niche && product.niche.some(n => niche.toLowerCase().includes(n))) score += 25;

      return { ...product, score };
    });

    const ranked = scored
      .filter(p => p.score > 0)
      .sort((a, b) => {
        const priorityDiff = b.priority - a.priority;
        return priorityDiff !== 0 ? priorityDiff : b.commission - a.commission;
      });

    if (ranked.length === 0) {
      return AFFILIATE_CATALOG.sort((a, b) => b.priority - a.priority).slice(0, 2);
    }

    return ranked.slice(0, 3);
  }

  async generateAffiliateDescriptionLinks(products: AffiliateProduct[], videoTitle: string): Promise<AffiliateLinkWithTracking[]> {
    const slug = videoTitle.replace(/[^a-z0-9]+/g, '-').toLowerCase().substring(0, 50);

    return products.map(p => {
      const utmParams = new URLSearchParams({
        utm_source: 'youtube',
        utm_medium: 'video_description',
        utm_campaign: slug,
        utm_content: p.id,
      });
      const separator = p.url.includes('?') ? '&' : '?';
      const utmUrl = `${p.url}${separator}${utmParams.toString()}`;

      return {
        productId: p.id,
        productName: p.name,
        affiliateUrl: p.url,
        utmUrl,
        commission: p.commission,
        placement: 'description-top3',
      };
    });
  }

  async generatePinnedComment(products: AffiliateLinkWithTracking[], topic: string): Promise<string> {
    const response = await generateWithAI(`
      Write a YouTube PINNED COMMENT for a video about "${topic}".

      The comment must:
      1. Greet the viewer naturally
      2. Mention the resources/products that can help them
      3. Include these links naturally:
      ${products.map(p => `- ${p.productName}: ${p.utmUrl}`).join('\n')}
      4. Add a question to drive engagement (replies)
      5. End with a soft CTA

      Style: friendly, helpful, conversational
      Max 300 characters.

      Return the comment text only, no JSON.
    `, 'ollama', { temperature: 0.4 });

    const clean = response.trim().replace(/^["']|["']$/g, '');
    return clean || `Thanks for watching! 🚀 Check out the resources I mentioned:\n${products.map(p => `🔗 ${p.productName}: ${p.utmUrl}`).join('\n')}\n\nWhich one interests you most? Let me know below! 👇`;
  }

  async recordClick(productId: string, projectId: string, videoId: string): Promise<void> {
    const existing = await prisma.monetizationConversion.findFirst({
      where: { productId, projectId },
    });

    if (existing) {
      await prisma.monetizationConversion.update({
        where: { id: existing.id },
        data: { clicks: existing.clicks + 1 },
      });
    } else {
      await prisma.monetizationConversion.create({
        data: {
          productId,
          projectId,
          videoId: videoId || projectId,
          clicks: 1,
          conversions: 0,
          revenue: 0,
          conversionRate: 0,
        },
      });
    }
  }

  async recordConversion(productId: string, projectId: string, revenue: number): Promise<void> {
    const existing = await prisma.monetizationConversion.findFirst({
      where: { productId, projectId },
    });

    if (existing) {
      const newConversions = existing.conversions + 1;
      const newRevenue = existing.revenue + revenue;
      await prisma.monetizationConversion.update({
        where: { id: existing.id },
        data: {
          conversions: newConversions,
          revenue: newRevenue,
          conversionRate: existing.clicks > 0 ? (newConversions / existing.clicks) * 100 : 0,
        },
      });
    } else {
      await prisma.monetizationConversion.create({
        data: {
          productId,
          projectId,
          videoId: projectId,
          clicks: 0,
          conversions: 1,
          revenue,
          conversionRate: 0,
        },
      });
    }
  }

  async getConversionSummary(projectId: string): Promise<ConversionRecord[]> {
    const records = await prisma.monetizationConversion.findMany({
      where: { projectId },
    });

    return records.map(r => ({
      productId: r.productId,
      projectId: r.projectId,
      videoId: r.videoId,
      clicks: r.clicks,
      conversions: r.conversions,
      revenue: r.revenue,
      conversionRate: r.clicks > 0 ? (r.conversions / r.clicks) * 100 : 0,
    }));
  }

  async getTopAffiliateProducts(limit = 5): Promise<{ productId: string; revenue: number; conversions: number }[]> {
    const records = await prisma.monetizationConversion.groupBy({
      by: ['productId'],
      _sum: { revenue: true, conversions: true },
      orderBy: { _sum: { revenue: 'desc' } },
      take: limit,
    });

    return records.map(r => ({
      productId: r.productId,
      revenue: r._sum.revenue || 0,
      conversions: r._sum.conversions || 0,
    }));
  }

  getProductCatalog(): AffiliateProduct[] {
    return AFFILIATE_CATALOG;
  }

  getProductsByNiche(niche: string): AffiliateProduct[] {
    const nicheLower = niche.toLowerCase();
    return AFFILIATE_CATALOG.filter(p =>
      p.niche.some(n => nicheLower.includes(n))
    ).sort((a, b) => b.priority - a.priority);
  }
}
