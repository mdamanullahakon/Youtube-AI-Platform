import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';

interface ChannelAssignment {
  channelId: string;
  channelName: string;
  niche: string;
  language: string;
  variation: 'original' | 'translated' | 'spin' | 'reaction';
  scheduleDay: number;
}

interface ContentVariation {
  title: string;
  description: string;
  tags: string[];
  thumbnailPromptModifier: string;
  introVariation: string;
}

export class MultiChannelEngine {
  async getChannelPool(userId: string): Promise<ChannelAssignment[]> {
    const accounts = await prisma.youTubeAccount.findMany({
      where: {
        userId,
        isConnected: true,
      },
    });

    return accounts.map((acc, i) => {
      const nicheMap = this.assignNiche(i, acc.channelTitle || `Channel ${i + 1}`);
      return {
        channelId: acc.channelId,
        channelName: acc.channelTitle || `Channel ${i + 1}`,
        niche: nicheMap.niche,
        language: nicheMap.language,
        variation: nicheMap.variation,
        scheduleDay: i % 7,
      };
    });
  }

  async assignContentToChannel(
    projectId: string,
    userId: string,
    baseTopic: string,
    baseTitle: string,
    baseDescription: string,
    baseTags: string[]
  ): Promise<{ channelId: string; variation: ContentVariation } | null> {
    const channels = await this.getChannelPool(userId);
    if (channels.length === 0) return null;

    const leastUsed = await this.findLeastUsedChannel(projectId, channels);
    if (!leastUsed) return null;

    const variation = this.createVariation(
      baseTitle,
      baseDescription,
      baseTags,
      leastUsed
    );

    logger.info(`[MultiChannel] Assigned ${projectId} to "${leastUsed.channelName}" (${leastUsed.niche}, ${leastUsed.language})`);

    return {
      channelId: leastUsed.channelId,
      variation,
    };
  }

  async getChannelSchedule(channelId: string): Promise<{ lastUpload: Date | null; optimalDay: number }> {
    const lastUpload = await prisma.uploadHistory.findFirst({
      where: { channelId },
      orderBy: { publishedAt: 'desc' },
      select: { publishedAt: true },
    });

    const uploads = await prisma.uploadHistory.findMany({
      where: { channelId },
      select: { publishedAt: true },
    });

    const dayPerformance = new Array(7).fill(0);
    for (const u of uploads) {
      if (u.publishedAt) {
        const day = u.publishedAt.getUTCDay();
        dayPerformance[day]++;
      }
    }

    const optimalDay = dayPerformance.indexOf(Math.max(...dayPerformance));
    return {
      lastUpload: lastUpload?.publishedAt || null,
      optimalDay: optimalDay >= 0 ? optimalDay : 0,
    };
  }

  private assignNiche(index: number, name: string): { niche: string; language: string; variation: ChannelAssignment['variation'] } {
    const niches = [
      { niche: 'main-horror', language: 'en', variation: 'original' as const },
      { niche: 'horror-espanol', language: 'es', variation: 'translated' as const },
      { niche: 'horror-portugues', language: 'pt', variation: 'translated' as const },
      { niche: 'horror-paranormal', language: 'en', variation: 'spin' as const },
      { niche: 'true-crime-horror', language: 'en', variation: 'spin' as const },
      { niche: 'horror-deutsch', language: 'de', variation: 'translated' as const },
      { niche: 'horror-francais', language: 'fr', variation: 'translated' as const },
      { niche: 'analog-horror', language: 'en', variation: 'spin' as const },
      { niche: 'horror-reaction', language: 'en', variation: 'reaction' as const },
      { niche: 'horror-shorts', language: 'en', variation: 'spin' as const },
    ];
    return niches[index % niches.length];
  }

  private async findLeastUsedChannel(
    projectId: string,
    channels: ChannelAssignment[]
  ): Promise<ChannelAssignment | null> {
    const usageCounts = await Promise.all(
      channels.map(async (ch) => {
        const count = await prisma.uploadHistory.count({
          where: { channelId: ch.channelId },
        });
        return { channel: ch, count };
      })
    );

    usageCounts.sort((a, b) => a.count - b.count);
    return usageCounts[0]?.channel || channels[0];
  }

  private createVariation(
    baseTitle: string,
    baseDescription: string,
    baseTags: string[],
    channel: ChannelAssignment
  ): ContentVariation {
    const titleModifiers: Record<string, string[]> = {
      'main-horror': ['', '(Horror Story)', '[Real Footage]'],
      'horror-espanol': ['(Historia de Terror)', '(Grabación Real)', '[No Mires]'],
      'horror-portugues': ['(História de Terror)', '[Filmagem Real]', '(Não Assista)'],
      'horror-paranormal': ['(Paranormal Activity)', '[Ghost Caught on Camera]', '(Real or Fake?)'],
      'true-crime-horror': ['(True Crime)', '[Investigation]', '(Unresolved)'],
      'analog-horror': ['(Analog Horror)', '[VHS Recording]', '(1990s Footage)'],
      'horror-reaction': ['(REACTION)', '[Watching So You Don\'t Have To]', '(Terrifying)'],
    };

    const modifier = (titleModifiers[channel.niche] || [''])[Math.floor(Math.random() * 3)];
    const title = modifier
      ? `${baseTitle.substring(0, 80 - modifier.length)} ${modifier}`
      : baseTitle.substring(0, 100);

    const description = this.modifyDescription(baseDescription, channel);
    const tags = this.modifyTags(baseTags, channel);
    const thumbnailPromptModifier = channel.niche === 'horror-reaction'
      ? ', split screen with reaction face'
      : channel.niche === 'analog-horror'
        ? ', VHS grain overlay, scan lines, 4:3 aspect ratio'
        : channel.niche.includes('espanol') || channel.niche.includes('portugues')
          ? ', text overlay in Spanish/Portuguese'
          : '';

    const introVariation = channel.variation === 'reaction'
      ? 'Before we start, I need to warn you... this footage is disturbing. I watched it so you do not have to alone.'
      : channel.variation === 'spin'
        ? 'There is a detail about this story that most people miss. Let me show you what I found.'
        : '';

    return { title, description, tags, thumbnailPromptModifier, introVariation };
  }

  private modifyDescription(description: string, channel: ChannelAssignment): string {
    const langFooter: Record<string, string> = {
      'en': '',
      'es': '\n\n📌 Subtítulos en español disponibles. Actívalos en la configuración del video.',
      'pt': '\n\n📌 Legendas em português disponíveis. Ative nas configurações do vídeo.',
      'de': '\n\n📌 Deutsche Untertitel verfügbar. Aktiviere sie in den Videoeinstellungen.',
      'fr': '\n\n📌 Sous-titres en français disponibles. Activez-les dans les paramètres vidéo.',
    };

    return `${description}${langFooter[channel.language] || ''}\n\n#horror #${channel.niche}`;
  }

  private modifyTags(tags: string[], channel: ChannelAssignment): string[] {
    const nicheTags: Record<string, string[]> = {
      'main-horror': ['horror', 'scary', 'paranormal'],
      'horror-espanol': ['horror', 'terror', 'paranormal', 'historias de terror'],
      'horror-paranormal': ['paranormal activity', 'ghost', 'supernatural'],
      'true-crime-horror': ['true crime', 'unsolved mystery', 'investigation'],
      'analog-horror': ['analog horror', 'vhs', 'found footage', '90s horror'],
    };

    const extra = nicheTags[channel.niche] || ['horror', 'scary'];
    return [...new Set([...tags, ...extra])];
  }
}
