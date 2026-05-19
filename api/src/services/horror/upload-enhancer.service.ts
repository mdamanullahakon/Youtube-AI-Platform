import { logger } from '../../utils/logger';
import { getAuthenticatedClient } from '../youtube-oauth.service';
import { google } from 'googleapis';
import { prisma } from '../../config/db';

interface UploadEnhancements {
  pinnedComment: string;
  hashtags: string[];
  playlistIds: string[];
  endScreenElements: EndScreenElement[];
  cards: Card[];
}

interface EndScreenElement {
  type: 'video' | 'playlist' | 'subscribe' | 'channel';
  videoId?: string;
  playlistId?: string;
}

interface Card {
  type: 'video' | 'playlist' | 'channel' | 'link';
  title: string;
  teaserText: string;
  videoId?: string;
}

const HORROR_HASHTAGS = [
  '#horrorstories', '#scary', '#paranormal', '#truecrime',
  '#haunted', '#creepy', '#horrorfiction', '#nightmare',
  '#unexplained', '#mystery',
];

const HORROR_PINNED_COMMENTS = [
  'What would YOU do if this happened to you? Tell me in the comments... if you dare. 👇',
  'I still can not sleep after researching this. Did I miss anything? Let me know below. 🔍',
  'This case has more layers than anyone realizes. Drop your theory below — I read every single one. 💀',
  'Subscribe for more horror documentaries. The next one is even worse. 🖤',
  'Share this with someone who needs to sleep with the lights on tonight. 😈',
];

export class UploadEnhancer {
  async enhanceUpload(
    projectId: string,
    userId: string,
    videoId: string,
    topic: string
  ): Promise<UploadEnhancements> {
    const hashtags = this.generateHashtags(topic);
    const pinnedComment = this.generatePinnedComment(topic);
    const playlistIds = await this.findOrCreatePlaylists(userId, topic);

    await this.postPinnedComment(videoId, pinnedComment, userId).catch(err =>
      logger.warn(`[UploadEnhancer] Pinned comment failed: ${err.message}`)
    );

    await this.addVideoToPlaylists(videoId, playlistIds, userId).catch(err =>
      logger.warn(`[UploadEnhancer] Playlist assignment failed: ${err.message}`)
    );

    logger.info(`[UploadEnhancer] Upload enhanced for ${videoId}: ${hashtags.length} hashtags, ${playlistIds.length} playlists, pinned comment posted`);

    return {
      pinnedComment,
      hashtags,
      playlistIds,
      endScreenElements: [],
      cards: [],
    };
  }

  async postPinnedComment(videoId: string, commentText: string, userId?: string): Promise<void> {
    try {
      const youtube = await this.getYouTubeClient(userId);
      const response = await youtube.commentThreads.insert({
        part: ['snippet'],
        requestBody: {
          snippet: {
            videoId,
            topLevelComment: {
              snippet: { textOriginal: commentText },
            },
          },
        },
      });

      const commentId = response.data.id;
      if (commentId) {
        await youtube.comments.setModerationStatus({
          id: [commentId],
          moderationStatus: 'published',
        }).catch(() => {});
      }
    } catch (err: any) {
      logger.warn(`[UploadEnhancer] Comment post failed: ${err.message}`);
    }
  }

  async addVideoToPlaylists(videoId: string, playlistIds: string[], userId?: string): Promise<void> {
    if (playlistIds.length === 0) return;

    try {
      const youtube = await this.getYouTubeClient(userId);
      for (const playlistId of playlistIds) {
        await youtube.playlistItems.insert({
          part: ['snippet'],
          requestBody: {
            snippet: {
              playlistId,
              resourceId: {
                kind: 'youtube#video',
                videoId,
              },
            },
          },
        }).catch(() => {});
      }
    } catch (err: any) {
      logger.warn(`[UploadEnhancer] Playlist assignment failed: ${err.message}`);
    }
  }

  private generateHashtags(topic: string): string[] {
    const topicWords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const topicHashtags = topicWords.slice(0, 3).map(w => `#${w}`);
    return [...new Set([...topicHashtags, ...HORROR_HASHTAGS])].slice(0, 8);
  }

  private generatePinnedComment(topic: string): string {
    const base = HORROR_PINNED_COMMENTS[Math.floor(Math.random() * HORROR_PINNED_COMMENTS.length)];
    const topicComment = `After researching ${topic}, I will never look at things the same way. What about you?`;
    return [topicComment, base][Math.floor(Math.random() * 2)];
  }

  private async findOrCreatePlaylists(userId: string, topic: string): Promise<string[]> {
    const playlistNames = ['Horror Documentaries', 'Scary Stories', 'Paranormal Activity', topic.substring(0, 30)];

    try {
      const youtube = await this.getYouTubeClient(userId);
      const existing = await youtube.playlists.list({
        part: ['snippet', 'id'],
        mine: true,
      });

      const existingNames = new Map(
        (existing.data.items || []).map(p => [p.snippet?.title, p.id])
      );

      const ids: string[] = [];
      for (const name of playlistNames) {
        if (existingNames.has(name)) {
          ids.push(existingNames.get(name)!);
        }
      }

      return ids.slice(0, 3);
    } catch {
      return [];
    }
  }

  private async getYouTubeClient(userId?: string) {
    if (userId) {
      try {
        const auth = await getAuthenticatedClient(userId);
        return google.youtube({ version: 'v3', auth });
      } catch {}
    }
    return google.youtube({ version: 'v3' });
  }
}
