import { prisma } from '../config/db';
import { logger } from '../utils/logger';

export interface AffiliateLink {
  keyword: string;
  url: string;
  niche: string;
  commission: number;
  priority: number;
}

export interface CPMRanking {
  niche: string;
  estimatedCPM: number;
  demandLevel: 'low' | 'medium' | 'high' | 'very-high';
  competitionLevel: 'low' | 'medium' | 'high';
  priority: number;
}

export const AFFILIATE_PROGRAMS: AffiliateLink[] = [
  { keyword: 'VPN', url: 'https://www.xvessel.com/go/vpn', niche: 'tech', commission: 8.00, priority: 10 },
  { keyword: 'NordVPN', url: 'https://www.xvessel.com/go/nordvpn', niche: 'tech', commission: 8.00, priority: 10 },
  { keyword: 'Surfshark', url: 'https://www.xvessel.com/go/surfshark', niche: 'tech', commission: 7.50, priority: 8 },
  { keyword: 'Skillshare', url: 'https://www.xvessel.com/go/skillshare', niche: 'education', commission: 5.00, priority: 7 },
  { keyword: 'Audible', url: 'https://www.xvessel.com/go/audible', niche: 'entertainment', commission: 5.00, priority: 7 },
  { keyword: 'BetterHelp', url: 'https://www.xvessel.com/go/betterhelp', niche: 'health', commission: 10.00, priority: 9 },
  { keyword: 'HelloFresh', url: 'https://www.xvessel.com/go/hellofresh', niche: 'lifestyle', commission: 5.00, priority: 6 },
  { keyword: 'Rakuten', url: 'https://www.xvessel.com/go/rakuten', niche: 'shopping', commission: 3.00, priority: 5 },
  { keyword: 'Fiverr', url: 'https://www.xvessel.com/go/fiverr', niche: 'business', commission: 4.00, priority: 6 },
  { keyword: 'Bluehost', url: 'https://www.xvessel.com/go/bluehost', niche: 'tech', commission: 6.00, priority: 8 },
  { keyword: 'Shopify', url: 'https://www.xvessel.com/go/shopify', niche: 'business', commission: 7.00, priority: 9 },
  { keyword: 'MasterClass', url: 'https://www.xvessel.com/go/masterclass', niche: 'education', commission: 6.00, priority: 7 },
];

export const CPM_BY_NICHE: Record<string, number> = {
  'Finance': 15, 'Insurance': 14, 'Business Stories': 12, 'True Crime': 10,
  'AI News': 8, 'Education': 8, 'Howto': 9, 'Tech Facts': 6,
  'Horror': 5, 'Celebrity Stories': 7, 'Motivation': 4,
  'Entertainment': 4, 'Gaming': 3, 'Music': 2, 'Sports': 5,
  'Science': 7, 'News': 6, 'Lifestyle': 8, 'Health': 12,
};

export class RevenueMultiplier {
  async injectAffiliateLinks(description: string, niche: string, keywords: string[]): Promise<string> {
    let enriched = description;

    const relevantPrograms = AFFILIATE_PROGRAMS
      .filter(a => {
        const nicheMatch = a.niche.toLowerCase() === niche.toLowerCase();
        const keywordMatch = keywords.some(k =>
          k.toLowerCase().includes(a.keyword.toLowerCase()) ||
          a.keyword.toLowerCase().includes(k.toLowerCase())
        );
        return nicheMatch || keywordMatch;
      })
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 3);

    if (relevantPrograms.length === 0) {
      const generalMatch = AFFILIATE_PROGRAMS
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 2);
      relevantPrograms.push(...generalMatch);
    }

    const affiliateSection = '\n\n---\n🔗 Resources mentioned in this video:\n' +
      relevantPrograms.map(a => {
        const anchor = a.keyword.replace(/\s+/g, '-').toLowerCase();
        return `- [${a.keyword}](${a.url}?ref=${anchor})`;
      }).join('\n');

    enriched += affiliateSection;
    return enriched;
  }

  async prioritizeHighCPMTopics(topics: string[]): Promise<{ topic: string; cpm: number; priority: number }[]> {
    return topics.map(topic => {
      let cpm = 5;
      for (const [niche, rate] of Object.entries(CPM_BY_NICHE)) {
        if (topic.toLowerCase().includes(niche.toLowerCase())) {
          cpm = rate;
          break;
        }
      }

      return {
        topic,
        cpm,
        priority: cpm >= 10 ? 10 : cpm >= 7 ? 7 : cpm >= 4 ? 4 : 2,
      };
    }).sort((a, b) => b.priority - a.priority);
  }

  async detectLongFormOpportunity(topic: string, format: string): Promise<{ shouldOptimize: boolean; suggestedDuration: string; reason: string }> {
    if (format === 'shorts') {
      return { shouldOptimize: false, suggestedDuration: '60s', reason: 'Shorts format - not applicable' };
    }

    const cpmRankings = await this.prioritizeHighCPMTopics([topic]);
    const cpm = cpmRankings[0]?.cpm || 5;

    if (cpm >= 8) {
      return {
        shouldOptimize: true,
        suggestedDuration: '10-15min',
        reason: `High CPM niche ($${cpm}). Long-form (10+ min) earns 3-5x more ad revenue per view. Mid-roll ads activate at 8min.`,
      };
    }

    if (cpm >= 5) {
      return {
        shouldOptimize: true,
        suggestedDuration: '8-10min',
        reason: `Medium CPM niche ($${cpm}). 8+ min unlocks mid-roll ads for 2x revenue.`,
      };
    }

    return {
      shouldOptimize: false,
      suggestedDuration: '5-8min',
      reason: `Lower CPM niche ($${cpm}). Shorter content may perform better for engagement.`,
    };
  }

  async optimizeDescriptionForRevenue(description: string, niche: string, keywords: string[]): Promise<{
    description: string;
    affiliateLinks: { keyword: string; url: string }[];
    estimatedRevenueBoost: number;
  }> {
    const enriched = await this.injectAffiliateLinks(description, niche, keywords);

    const linkMatchRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const affiliateLinks: { keyword: string; url: string }[] = [];
    let match;
    while ((match = linkMatchRegex.exec(enriched)) !== null) {
      affiliateLinks.push({ keyword: match[1], url: match[2] });
    }

    const cpmInfo = await this.prioritizeHighCPMTopics([niche]);
    const baseCPM = cpmInfo[0]?.cpm || 5;
    const estimatedRevenueBoost = affiliateLinks.length > 0 ? baseCPM * 0.15 : 0;

    return { description: enriched, affiliateLinks, estimatedRevenueBoost };
  }

  async getRevenueProjection(niche: string, monthlyViews: number): Promise<{
    adRevenue: number;
    affiliateRevenue: number;
    totalRevenue: number;
    breakdown: string;
  }> {
    const cpm = CPM_BY_NICHE[niche] || 5;
    const adRevenue = (monthlyViews / 1000) * cpm;

    const nicheFactor = cpm >= 10 ? 0.25 : cpm >= 7 ? 0.15 : 0.08;
    const affiliateRevenue = (monthlyViews / 1000) * nicheFactor * 8;

    return {
      adRevenue: Math.round(adRevenue * 100) / 100,
      affiliateRevenue: Math.round(affiliateRevenue * 100) / 100,
      totalRevenue: Math.round((adRevenue + affiliateRevenue) * 100) / 100,
      breakdown: `Ad revenue ($${cpm} CPM × ${Math.round(monthlyViews / 1000)}K views) + Affiliate revenue (${Math.round(nicheFactor * 100)}% conversion rate)`,
    };
  }
}
