import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { SmartAffiliateEngine, AffiliateProduct, AffiliateLinkWithTracking } from './smart-affiliate-engine.service';
import { FunnelEngine, ConversionFunnel } from './funnel-engine.service';
import { MonetizationAnalytics, MonetizationMetrics } from './monetization-analytics.service';
import { CommercialContentFilter, CommercialIntentScore } from './commercial-content-filter.service';
import { MoneyFeedbackLoop, RevenuePattern } from './money-feedback-loop.service';
import { ShortsLongFormFunnel, ShortsLongFormLink } from './shorts-long-form-funnel.service';
import { CTAOptimizationEngine, CTAVariant, PinnedCommentScript } from './cta-optimization-engine.service';
import { MultiIncomeStream, IncomeStream, OfferMatch } from './multi-income-stream.service';
import { RevenueBasedScaler, RevenueBasedChannelScore } from './revenue-based-scaler.service';

export interface MonetizedUploadResult {
  projectId: string;
  topic: string;
  commercialGatePassed: boolean;
  affiliateProducts: AffiliateProduct[];
  affiliateLinks: AffiliateLinkWithTracking[];
  pinnedComment: string;
  bestCTA: CTAVariant;
  landingPageHtml: string;
  funnel: ConversionFunnel;
  incomeStreamType: string;
  primaryOffer: string;
  revenueProjection: number;
  experiments: { testType: string; variantA: string; variantB: string }[];
}

export class MonetizationOrchestrator {
  private affiliateEngine: SmartAffiliateEngine;
  private funnelEngine: FunnelEngine;
  private monetizationAnalytics: MonetizationAnalytics;
  private commercialFilter: CommercialContentFilter;
  private moneyFeedback: MoneyFeedbackLoop;
  private shortsLongForm: ShortsLongFormFunnel;
  private ctaEngine: CTAOptimizationEngine;
  private incomeStreams: MultiIncomeStream;
  private revenueScaler: RevenueBasedScaler;

  constructor() {
    this.affiliateEngine = new SmartAffiliateEngine();
    this.funnelEngine = new FunnelEngine();
    this.monetizationAnalytics = new MonetizationAnalytics();
    this.commercialFilter = new CommercialContentFilter();
    this.moneyFeedback = new MoneyFeedbackLoop();
    this.shortsLongForm = new ShortsLongFormFunnel();
    this.ctaEngine = new CTAOptimizationEngine();
    this.incomeStreams = new MultiIncomeStream();
    this.revenueScaler = new RevenueBasedScaler();
  }

  async prepareMonetization(
    projectId: string,
    videoId: string,
    topic: string,
    keywords: string[],
    niche?: string,
    format = 'long-form'
  ): Promise<MonetizedUploadResult> {
    logger.info(`[MonetizationOrchestrator] Preparing monetization for ${projectId}: ${topic}`);

    const gate = await this.commercialFilter.gateContent(topic, keywords, format);
    if (!gate.allowed) {
      throw new Error(`MONETIZATION_GATE_BLOCKED: ${gate.blockReason}`);
    }

    const affiliateProducts = await this.affiliateEngine.selectProductsForVideo(topic, keywords, niche);
    const affiliateLinks = await this.affiliateEngine.generateAffiliateDescriptionLinks(affiliateProducts, topic);

    const ctaVariants = await this.ctaEngine.generateCTAVariants(topic, affiliateProducts[0]?.name);
    const bestCTA = await this.ctaEngine.selectBestCTA(ctaVariants);

    const pinnedComment = await this.ctaEngine.generatePinnedComment(
      bestCTA.text,
      topic,
      affiliateLinks[0]?.utmUrl
    );

    const { landingPageHtml, funnel } = await this.funnelEngine.buildVideoFunnel(
      projectId,
      videoId,
      topic,
      keywords,
      niche
    );

    const offer = await this.incomeStreams.selectBestOffer(topic, keywords, niche);

    const revenueGuidance = await this.moneyFeedback.enrichPromptWithRevenueData('');

    const monthlyViews = 10000;
    const revenueProj = await this.incomeStreams.getCombinedRevenueProjection(monthlyViews);

    if (format === 'shorts') {
      const longFormProjects = await prisma.videoProject.findMany({
        where: { format: { not: 'shorts' }, uploadHistory: { status: 'published' } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      if (longFormProjects.length > 0) {
        await this.shortsLongForm.createShortToLongFormLink(projectId, longFormProjects[0].id, niche);
      }
    }

    return {
      projectId,
      topic,
      commercialGatePassed: true,
      affiliateProducts,
      affiliateLinks,
      pinnedComment: pinnedComment.text,
      bestCTA,
      landingPageHtml,
      funnel,
      incomeStreamType: offer.type,
      primaryOffer: 'name' in offer.primary ? offer.primary.name : (offer.primary as AffiliateProduct).name,
      revenueProjection: revenueProj.totalProjection,
      experiments: ctaVariants.map(v => ({
        testType: 'cta-style',
        variantA: ctaVariants[0]?.text || '',
        variantB: v.text,
      })),
    };
  }

  async recordVideoMetrics(projectId: string): Promise<MonetizationMetrics | null> {
    return this.monetizationAnalytics.computeVideoMonetization(projectId);
  }

  async runDailyMonetizationCycle(): Promise<{
    videosProcessed: number;
    revenueTracked: number;
    funnelsBuilt: number;
    shortsLinked: number;
    scalingResults: any;
    totalRevenue: number;
    totalProfit: number;
  }> {
    const publishedProjects = await prisma.videoProject.findMany({
      where: { status: 'published', uploadHistory: { status: 'uploaded' } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    let totalRevenue = 0;
    let totalProfit = 0;
    let funnelsBuilt = 0;
    let shortsLinked = 0;

    for (const project of publishedProjects) {
      try {
        const metrics = await this.monetizationAnalytics.computeVideoMonetization(project.id);
        if (metrics) {
          totalRevenue += metrics.totalRevenue;
          totalProfit += metrics.profit;
        }

        const existingFunnel = await prisma.monetizationConversionFunnel.findUnique({
          where: { projectId: project.id },
        });
        if (!existingFunnel) {
          const upload = await prisma.uploadHistory.findUnique({ where: { projectId: project.id } });
          await this.funnelEngine.buildVideoFunnel(
            project.id,
            upload?.videoId || project.id,
            project.topic,
            [project.topic],
            undefined
          );
          funnelsBuilt++;
        }
      } catch {}
    }

    const shortsLinks = await this.shortsLongForm.autoLinkShortsToLongForm();
    shortsLinked = shortsLinks.length;

    const scalingResults = await this.revenueScaler.executeRevenueScaling(true);

    return {
      videosProcessed: publishedProjects.length,
      revenueTracked: publishedProjects.length,
      funnelsBuilt,
      shortsLinked,
      scalingResults,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalProfit: Math.round(totalProfit * 100) / 100,
    };
  }

  async getRevenueInsights(): Promise<{
    topRevenueTopics: { topic: string; avgRevenuePerView: number; totalRevenue: number; count: number }[];
    topRevenuePatterns: RevenuePattern[];
    topProfitNiches: { niche: string; totalProfit: number; avgMargin: number; channels: number }[];
    scalingStatus: RevenueBasedChannelScore[];
    revenueGuidance: string[];
    totalPortfolioRevenue: number;
    totalPortfolioProfit: number;
  }> {
    const [topics, patterns, niches, scaling, guidance] = await Promise.all([
      this.moneyFeedback.getTopRevenueTopics(5),
      this.moneyFeedback.extractRevenuePatterns(),
      this.revenueScaler.getTopProfitNiches(5),
      this.revenueScaler.evaluateAllChannelsByRevenue(),
      this.moneyFeedback.getRevenueGenerationGuidance(),
    ]);

    const totalPortfolioRevenue = scaling.reduce((s, c) => s + c.totalRevenue, 0);
    const totalPortfolioProfit = scaling.reduce((s, c) => s + c.totalProfit, 0);

    return {
      topRevenueTopics: topics,
      topRevenuePatterns: patterns.slice(0, 10),
      topProfitNiches: niches,
      scalingStatus: scaling,
      revenueGuidance: guidance,
      totalPortfolioRevenue: Math.round(totalPortfolioRevenue * 100) / 100,
      totalPortfolioProfit: Math.round(totalPortfolioProfit * 100) / 100,
    };
  }
}
