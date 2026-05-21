import { prisma } from '../config/db';
import { logger } from '../utils/logger';

interface RevenueEstimate {
  estimatedViews: number;
  estimatedRpm: number;
  estimatedRevenue: number;
  confidence: 'low' | 'medium' | 'high';
  breakdown: {
    adsense: number;
    affiliate: number;
    external: number;
  };
}

const NICHE_RPM: Record<string, number> = {
  finance: 15, investing: 15, crypto: 12, money: 10,
  technology: 8, ai: 8, programming: 7, software: 7,
  business: 10, marketing: 9, entrepreneurship: 10,
  education: 5, science: 4, history: 4,
  entertainment: 2, gaming: 2, music: 1.5, vlog: 1,
};

const DEFAULT_RPM = 3.5;

function getNicheRpm(topic: string): number {
  const tl = topic.toLowerCase();
  for (const [niche, rpm] of Object.entries(NICHE_RPM)) {
    if (tl.includes(niche)) return rpm;
  }
  return DEFAULT_RPM;
}

export class RevenueTracker {
  async estimateRevenue(projectId: string): Promise<RevenueEstimate | null> {
    try {
      const project = await prisma.videoProject.findUnique({
        where: { id: projectId },
        include: { analytics: true },
      });
      if (!project) return null;

      const analytics = project.analytics;
      const views = analytics?.views || 0;
      const ctr = analytics?.ctr || 0;
      const retention = analytics?.retention || 0;
      const rpm = getNicheRpm(project.topic);
      const expectedViews = views > 0 ? views : this.projectViews(ctr, retention, project.topic);
      const adsenseRevenue = expectedViews * (rpm / 1000);
      const affiliateRevenue = expectedViews * 0.001 * 5;
      const externalRevenue = expectedViews * 0.0005 * 10;
      const totalRevenue = adsenseRevenue + affiliateRevenue + externalRevenue;
      const confidence = views > 1000 ? 'high' : views > 100 ? 'medium' : 'low';

      return {
        estimatedViews: Math.round(expectedViews),
        estimatedRpm: rpm,
        estimatedRevenue: Math.round(totalRevenue * 100) / 100,
        confidence,
        breakdown: {
          adsense: Math.round(adsenseRevenue * 100) / 100,
          affiliate: Math.round(affiliateRevenue * 100) / 100,
          external: Math.round(externalRevenue * 100) / 100,
        },
      };
    } catch (err: any) {
      logger.warn(`[RevenueTracker] Estimate failed: ${err.message}`);
      return null;
    }
  }

  async trackActualRevenue(projectId: string): Promise<void> {
    try {
      const project = await prisma.videoProject.findUnique({
        where: { id: projectId },
        include: { analytics: true },
      });
      if (!project || !project.analytics) return;

      const { analytics } = project;
      const views = analytics.views || 0;
      const rpm = getNicheRpm(project.topic);
      const estimatedRevenue = views * (rpm / 1000);

      await prisma.contentPerformance.upsert({
        where: { projectId },
        update: { actualViews: views, updatedAt: new Date() },
        create: { projectId, actualViews: views },
      }).catch(() => {});

      logger.info(`[RevenueTracker] Tracked: ${views} views × $${rpm} RPM = $${estimatedRevenue.toFixed(2)}`);
    } catch (err: any) {
      logger.warn(`[RevenueTracker] Track failed: ${err.message}`);
    }
  }

  private projectViews(ctr: number, retention: number, topic: string): number {
    const baseViews = 500;
    const ctrMul = 1 + (ctr * 5);
    const retMul = 1 + (retention * 3);
    const nicheMul = getNicheRpm(topic) / DEFAULT_RPM;
    return Math.round(baseViews * ctrMul * retMul * nicheMul);
  }
}
