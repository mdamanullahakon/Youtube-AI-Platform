import { prisma } from '../../config/db';
import { generateWithAI } from '../ai.service';
import { logger } from '../../utils/logger';
import { extractJsonArray } from '../../utils/parse-ai-response';

export interface MonetizationStrategy {
  niche: string;
  rpmEstimate: number;
  affiliateOpportunities: AffiliateProduct[];
  adBreakPoints: number[];
  ctaStrategy: string;
  descriptionTemplate: string;
  pinnedCommentTemplate: string;
}

export interface AffiliateProduct {
  productName: string;
  category: string;
  commissionRate: number;
  relevanceScore: number;
  urlTemplate: string;
}

const NICHE_RPM: Record<string, number> = {
  'true crime': 12.50,
  'paranormal': 8.75,
  'horror documentary': 7.20,
  'unsolved mysteries': 10.30,
  'conspiracy': 9.80,
  'psychological horror': 6.50,
  'analog horror': 5.80,
  'missing persons': 11.20,
};

export class MonetizationIntelligence {
  async getStrategyForNiche(niche: string): Promise<MonetizationStrategy> {
    const rpm = NICHE_RPM[niche.toLowerCase()] || 6.0;
    const affiliates = await this.findAffiliates(niche);

    const strategy: MonetizationStrategy = {
      niche,
      rpmEstimate: rpm,
      affiliateOpportunities: affiliates,
      adBreakPoints: this.calculateAdBreaks(niche),
      ctaStrategy: this.getCTAStrategy(niche),
      descriptionTemplate: this.generateDescriptionTemplate(niche, affiliates),
      pinnedCommentTemplate: this.generatePinnedComment(niche),
    };

    await this.saveStrategy(strategy);
    return strategy;
  }

  async optimizeDescription(description: string, niche: string, tags: string[]): Promise<string> {
    const strategy = await this.getStrategyForNiche(niche);

    let optimized = description;
    const affiliateSection = strategy.affiliateOpportunities.length > 0
      ? `\n\n---\n📚 Resources mentioned:\n${strategy.affiliateOpportunities.map((a, i) =>
        `${i + 1}. ${a.productName} — ${a.urlTemplate.replace('{niche}', niche)}`
      ).join('\n')}`
      : '';

    const ctaSection = `\n\n${strategy.pinnedCommentTemplate}`;
    const tagSection = `\n\n${tags.slice(0, 8).map(t => `#${t.replace(/\s+/g, '')}`).join(' ')}`;

    optimized = `${optimized}${affiliateSection}${ctaSection}${tagSection}`;

    return optimized;
  }

  async suggestAffiliates(niche: string, topic: string): Promise<AffiliateProduct[]> {
    const response = await generateWithAI(`
      Suggest 3-5 affiliate products relevant to a YouTube video about "${topic}" in the "${niche}" niche.

      Focus on:
      - Books about the topic
      - Documentaries or streaming services
      - Security equipment (for true crime/horror)
      - Paranormal investigation tools
      - Self-defense products
      - Home security cameras

      For each product, provide:
      - productName (string)
      - category (string)
      - commissionRate (0-30 as number)
      - relevanceScore (0-100)
      - urlTemplate (generic URL with {niche} placeholder)

      Return as JSON array.
    `, 'ollama', { temperature: 0.5 });

    try {
      const parsed = extractJsonArray<any>(response);
      if (parsed?.length) return parsed.map(p => ({
        productName: p.productName || 'Recommended Product',
        category: p.category || 'General',
        commissionRate: p.commissionRate || 5,
        relevanceScore: p.relevanceScore || 50,
        urlTemplate: p.urlTemplate || `https://amazon.com/s?k={niche}`,
      }));
    } catch {}

    return [
      { productName: `${niche} Book Collection`, category: 'books', commissionRate: 8, relevanceScore: 85, urlTemplate: 'https://amazon.com/s?k={niche}+books' },
      { productName: 'Home Security Camera', category: 'security', commissionRate: 12, relevanceScore: 70, urlTemplate: 'https://amazon.com/s?k=home+security+camera' },
    ];
  }

  private async findAffiliates(niche: string): Promise<AffiliateProduct[]> {
    const affiliates: Record<string, AffiliateProduct[]> = {
      'true crime': [
        { productName: 'True Crime Book Collection', category: 'books', commissionRate: 8, relevanceScore: 90, urlTemplate: 'https://amazon.com/s?k=true+crime+books' },
        { productName: 'Audio Documentary Subscription', category: 'streaming', commissionRate: 15, relevanceScore: 75, urlTemplate: 'https://amazon.com/s?k=audible+true+crime' },
        { productName: 'Home Security Camera', category: 'security', commissionRate: 10, relevanceScore: 65, urlTemplate: 'https://amazon.com/s?k=home+security+camera' },
      ],
      'paranormal': [
        { productName: 'Paranormal Investigation Kit', category: 'equipment', commissionRate: 12, relevanceScore: 95, urlTemplate: 'https://amazon.com/s?k=paranormal+investigation+kit' },
        { productName: 'Ghost Hunting Book', category: 'books', commissionRate: 8, relevanceScore: 80, urlTemplate: 'https://amazon.com/s?k=ghost+hunting+book' },
        { productName: 'Night Vision Camera', category: 'electronics', commissionRate: 10, relevanceScore: 70, urlTemplate: 'https://amazon.com/s?k=night+vision+camera' },
      ],
      'horror documentary': [
        { productName: 'Horror Documentary Collection', category: 'streaming', commissionRate: 15, relevanceScore: 85, urlTemplate: 'https://amazon.com/s?k=horror+documentary+dvd' },
        { productName: 'Horror Book Bundle', category: 'books', commissionRate: 8, relevanceScore: 75, urlTemplate: 'https://amazon.com/s?k=horror+book+bundle' },
      ],
    };
    return affiliates[niche.toLowerCase()] || affiliates['true crime'];
  }

  private calculateAdBreaks(niche: string): number[] {
    const baseBreaks = [180, 420, 660, 900];
    if (NICHE_RPM[niche.toLowerCase()] && NICHE_RPM[niche.toLowerCase()] > 8) {
      return [120, 300, 480, 660, 840, 1020];
    }
    return baseBreaks;
  }

  private getCTAStrategy(niche: string): string {
    return 'Pin comment with affiliate link + engagement question. Add resource links in description top 3 lines.';
  }

  private generateDescriptionTemplate(niche: string, affiliates: AffiliateProduct[]): string {
    const affiliateLines = affiliates.map((a, i) =>
      `${i + 1}. ${a.productName}: ${a.urlTemplate.replace('{niche}', niche)}`
    ).join('\n');
    return `📌 Resources & Links:\n${affiliateLines}\n\n🔔 Subscribe for more ${niche} content\n💬 Comment your thoughts below`;
  }

  private generatePinnedComment(niche: string): string {
    return `What do you think about this ${niche} case? Let me know below. 🔍\n\n📚 Resources mentioned in the description 👆`;
  }

  private async saveStrategy(strategy: MonetizationStrategy): Promise<void> {
    try {
      await prisma.strategyDecision.create({
        data: {
          channelId: 'global',
          userId: 'system',
          decisionType: 'MONETIZATION_STRATEGY',
          growthScore: strategy.rpmEstimate * 10,
          reasoning: `Monetization strategy for ${strategy.niche}: RPM $${strategy.rpmEstimate}, ${strategy.affiliateOpportunities.length} affiliates`,
          actions: strategy as any,
        },
      });
    } catch {}
  }
}
