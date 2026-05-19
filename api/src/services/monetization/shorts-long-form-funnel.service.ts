import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';

export interface ShortsLongFormLink {
  shortsProjectId: string;
  shortsVideoId: string;
  longFormProjectId: string;
  longFormVideoId: string;
  shortsTitle: string;
  longFormTitle: string;
  linkType: 'description' | 'card' | 'pinned-comment';
  trafficDriven: number;
  conversionsFromTraffic: number;
}

export class ShortsLongFormFunnel {
  async createShortToLongFormLink(
    shortsProjectId: string,
    longFormProjectId: string,
    niche?: string
  ): Promise<ShortsLongFormLink | null> {
    const shorts = await prisma.videoProject.findUnique({
      where: { id: shortsProjectId },
      include: { uploadHistory: true },
    });
    const longForm = await prisma.videoProject.findUnique({
      where: { id: longFormProjectId },
      include: { uploadHistory: true },
    });

    if (!shorts?.uploadHistory?.videoId || !longForm?.uploadHistory?.videoId) {
      logger.warn('[ShortsLongForm] Both videos must be uploaded before linking');
      return null;
    }

    const shortVideoId = shorts.uploadHistory.videoId;
    const longVideoId = longForm.uploadHistory.videoId;

    const link: ShortsLongFormLink = {
      shortsProjectId,
      shortsVideoId: shortVideoId,
      longFormProjectId,
      longFormVideoId: longVideoId,
      shortsTitle: shorts.title || shorts.topic,
      longFormTitle: longForm.title || longForm.topic,
      linkType: 'description',
      trafficDriven: 0,
      conversionsFromTraffic: 0,
    };

    const response = await generateWithAI(`
      Write a YouTube description CTA for a SHORTS video that drives viewers to watch a LONG-FORM video.
      
      Shorts title: "${shorts.title || shorts.topic}"
      Long-form title: "${longForm.title || longForm.topic}"
      
      Rules:
      - Must hook shorts viewers to watch the full video
      - Create curiosity about what the long-form reveals
      - Max 2 sentences
      - Include the link naturally
      
      Return ONLY the CTA text, no JSON.
    `, 'ollama', { temperature: 0.4 });

    const ctaText = response.trim().replace(/^["']|["']$/g, '')
      .substring(0, 300);

    const shortsDescription = shorts.uploadHistory.description || '';
    const enrichedDescription = `${shortsDescription}\n\n📺 Watch the full story: ${longForm.title || longForm.topic}\n${ctaText}\n🎬 https://youtube.com/watch?v=${longVideoId}`;

    await prisma.uploadHistory.update({
      where: { projectId: shortsProjectId },
      data: { description: enrichedDescription },
    });

    const existingLink = await prisma.shortsLongFormLink.findFirst({
      where: { shortsProjectId },
    });

    if (existingLink) {
      await prisma.shortsLongFormLink.update({
        where: { id: existingLink.id },
        data: {
          longFormProjectId,
          longFormVideoId: longVideoId,
          linkType: 'description',
        },
      });
    } else {
      await prisma.shortsLongFormLink.create({
        data: {
          shortsProjectId,
          shortsVideoId: shortVideoId,
          longFormProjectId,
          longFormVideoId: longVideoId,
          shortsTitle: shorts.title || shorts.topic,
          longFormTitle: longForm.title || longForm.topic,
          linkType: 'description',
          trafficDriven: 0,
          conversionsFromTraffic: 0,
        },
      });
    }

    logger.info(`[ShortsLongForm] Linked short ${shortVideoId} → long-form ${longVideoId}`);

    return link;
  }

  async recordTraffic(shortsVideoId: string, clicks: number): Promise<void> {
    await prisma.shortsLongFormLink.updateMany({
      where: { shortsVideoId },
      data: { trafficDriven: { increment: clicks } },
    });
  }

  async recordConversion(shortsVideoId: string, conversions: number): Promise<void> {
    await prisma.shortsLongFormLink.updateMany({
      where: { shortsVideoId },
      data: { conversionsFromTraffic: { increment: conversions } },
    });
  }

  async autoLinkShortsToLongForm(niche?: string): Promise<ShortsLongFormLink[]> {
    const linkedShortIds = (await prisma.shortsLongFormLink.findMany({
      select: { shortsProjectId: true },
    })).map(l => l.shortsProjectId);

    const publishedShorts = await prisma.videoProject.findMany({
      where: {
        format: 'shorts',
        uploadHistory: { status: 'published' },
        id: { notIn: linkedShortIds.length > 0 ? linkedShortIds : ['__none__'] },
      },
      include: { uploadHistory: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const longFormWhere: any = {
      format: { not: 'shorts' },
      uploadHistory: { status: 'published' },
    };
    if (niche) longFormWhere.topic = { contains: niche };

    const longFormVideos = await prisma.videoProject.findMany({
      where: longFormWhere,
      include: { uploadHistory: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (publishedShorts.length === 0 || longFormVideos.length === 0) return [];

    const links: ShortsLongFormLink[] = [];
    for (let i = 0; i < Math.min(publishedShorts.length, longFormVideos.length); i++) {
      const link = await this.createShortToLongFormLink(
        publishedShorts[i].id,
        longFormVideos[i].id,
        niche
      );
      if (link) links.push(link);
    }

    return links;
  }

  async getFunnelPerformance(niche?: string): Promise<{
    totalLinks: number;
    totalTraffic: number;
    totalConversions: number;
    avgConversionRate: number;
  }> {
    const where: any = {};
    if (niche) {
      const projects = await prisma.videoProject.findMany({
        where: { topic: { contains: niche } },
        select: { id: true },
      });
      where.shortsProjectId = { in: projects.map(p => p.id) };
    }

    const links = await prisma.shortsLongFormLink.findMany({ where });
    const totalTraffic = links.reduce((s, l) => s + l.trafficDriven, 0);
    const totalConversions = links.reduce((s, l) => s + l.conversionsFromTraffic, 0);

    return {
      totalLinks: links.length,
      totalTraffic,
      totalConversions,
      avgConversionRate: totalTraffic > 0 ? (totalConversions / totalTraffic) * 100 : 0,
    };
  }
}
