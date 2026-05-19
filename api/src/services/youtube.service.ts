import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { getAuthenticatedClient } from './youtube-oauth.service';
import { prisma } from '../config/db';
import { google } from 'googleapis';

interface YouTubeUploadOptions {
  title: string;
  description: string;
  tags: string[];
  categoryId?: string;
  privacyStatus?: 'public' | 'private' | 'unlisted';
  videoPath: string;
  thumbnailPath?: string;
  userId?: string;
  channelId?: string;
}

export class YouTubeAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YouTubeAuthError';
  }
}

export async function uploadToYouTube(options: YouTubeUploadOptions): Promise<string> {
  const { createReadStream } = await import('fs');
  const { default: FormData } = await import('form-data');

  let accessToken: string | null = null;
  let lastOAuthError: string | null = null;

  // Try channel-specific auth first
  if (options.channelId && options.userId) {
    try {
      const account = await prisma.youTubeAccount.findFirst({
        where: { userId: options.userId, channelId: options.channelId, isConnected: true },
      });
      if (account) {
        const oauth2Client = await getAuthenticatedClient(options.userId);
        const token = await oauth2Client.getAccessToken();
        accessToken = token?.token || null;
      }
    } catch (err: any) {
      lastOAuthError = err.message;
      logger.warn('Failed to get OAuth token from channel account', { error: err.message, channelId: options.channelId });
    }
  }

  // Fallback: user-level OAuth
  if (!accessToken && options.userId) {
    try {
      const oauth2Client = await getAuthenticatedClient(options.userId);
      const token = await oauth2Client.getAccessToken();
      accessToken = token?.token || null;
    } catch (err: any) {
      lastOAuthError = err.message;
      logger.warn('Failed to get OAuth token from connected account', { error: err.message });
    }
  }

  if (!accessToken) {
    accessToken = await getAccessTokenFromEnv();
  }

  if (!accessToken) {
    const message = lastOAuthError
      ? `No valid YouTube OAuth token: ${lastOAuthError}. Reconnect your YouTube channel in Settings.`
      : 'No valid YouTube OAuth token available. Connect a YouTube channel in Settings, or configure YOUTUBE_REFRESH_TOKEN in .env.';
    throw new YouTubeAuthError(message);
  }

  try {
    const { google } = await import('googleapis');
    const authClient = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
    );
    authClient.setCredentials({ access_token: accessToken });

    const youtube = google.youtube({ version: 'v3', auth: authClient });
    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: options.title,
          description: options.description,
          tags: options.tags,
          categoryId: options.categoryId || '22',
        },
        status: {
          privacyStatus: options.privacyStatus || 'public',
        },
      },
      media: {
        body: createReadStream(options.videoPath),
      },
    });

    const videoId = response.data.id;
    if (!videoId) throw new Error('Upload succeeded but no video ID returned');

    if (options.thumbnailPath) {
      try {
        await youtube.thumbnails.set({
          videoId,
          media: {
            body: createReadStream(options.thumbnailPath),
          },
        });
      } catch (thumbError) {
        logger.error('Thumbnail upload failed', thumbError);
      }
    }

    return videoId;
  } catch (error: any) {
    const status = error?.response?.status;
    const body = error?.response?.data;
    const errorType = body?.error || '';

    if (status === 401 || errorType === 'invalid_grant') {
      throw new YouTubeAuthError(
        'YouTube OAuth token is invalid or expired. ' +
        'Reconnect your YouTube channel in Settings. ' +
        `(Google API error: ${errorType || '401 Unauthorized'})`
      );
    }
    if (status === 403) {
      throw new YouTubeAuthError(
        'YouTube API quota exceeded or insufficient permissions. ' +
        'Check your Google Cloud Console quota and OAuth scopes. ' +
        `(Google API error: ${errorType || '403 Forbidden'})`
      );
    }
    if (status === 404) {
      throw new YouTubeAuthError(
        'YouTube video resource not found. ' +
        `(Google API error: ${errorType || '404 Not Found'})`
      );
    }

    logger.error('YouTube upload failed', {
      error: error.message,
      status,
      errorType,
      stack: error.stack,
    });
    throw error;
  }
}

async function getAccessTokenFromEnv(): Promise<string | null> {
  try {
    if (env.YOUTUBE_REFRESH_TOKEN) {
      const response = await axios.post('https://oauth2.googleapis.com/token', {
        client_id: env.YOUTUBE_CLIENT_ID,
        client_secret: env.YOUTUBE_CLIENT_SECRET,
        refresh_token: env.YOUTUBE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }, {
        timeout: 30000,
      });
      return response.data.access_token;
    }
    return null;
  } catch (error) {
    logger.error('Failed to get YouTube access token from env', error);
    return null;
  }
}

export async function postVideoComment(videoId: string, text: string, userId?: string): Promise<void> {
  try {
    const youtube = await getYouTubeClient(userId);
    await youtube.commentThreads.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          videoId,
          topLevelComment: {
            snippet: {
              textOriginal: text,
            },
          },
        },
      },
    });
    logger.info(`[YouTube] Comment posted on ${videoId}`);
  } catch (error: any) {
    logger.warn(`[YouTube] Failed to post comment on ${videoId}: ${error.message}`);
  }
}

export async function updateVideoMetadata(
  videoId: string,
  updates: { title?: string; description?: string; tags?: string[] },
  userId?: string,
): Promise<void> {
  try {
    const youtube = await getYouTubeClient(userId);

    const existing = await youtube.videos.list({
      part: ['snippet'],
      id: [videoId],
    });
    const video = existing.data.items?.[0];
    if (!video) throw new Error('Video not found');

    const snippet = {
      title: updates.title || video.snippet?.title || '',
      description: updates.description || video.snippet?.description || '',
      tags: updates.tags || video.snippet?.tags || [],
      categoryId: video.snippet?.categoryId || '22',
    };

    await youtube.videos.update({
      part: ['snippet'],
      requestBody: {
        id: videoId,
        snippet,
      },
    });
    logger.info(`[YouTube] Updated metadata for ${videoId}`);
  } catch (error: any) {
    logger.warn(`[YouTube] Failed to update metadata for ${videoId}: ${error.message}`);
  }
}

export async function getVideoAnalytics(videoId: string, userId?: string): Promise<any> {
  try {
    const youtube = await getYouTubeClient(userId);

    const videoResponse = await youtube.videos.list({
      part: ['statistics', 'snippet'],
      id: [videoId],
    });

    const video = videoResponse.data.items?.[0];
    if (!video) return null;

    const stats = video.statistics;

    let ctr = 0;
    let retention = 0;
    let watchTime = 0;
    let subscribersGained = 0;
    let impressions = 0;
    let avgViewDuration = 0;

    // Enrich with YouTube Analytics API data if user is authenticated
    if (userId) {
      try {
        const auth = await getAuthenticatedClient(userId);
        const analytics = google.youtubeAnalytics({ version: 'v2', auth });

        const channelId = video.snippet?.channelId;
        if (channelId) {
          const endDate = new Date().toISOString().split('T')[0];
          const startDate = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

          const reportResponse = await analytics.reports.query({
            ids: `channel==${channelId}`,
            startDate,
            endDate,
            metrics: 'estimatedMinutesWatched,averageViewDurationPercentage,impressions,impressionsCtr,subscribersGained',
            dimensions: 'video',
            filters: `video==${videoId}`,
          });

          const rows = reportResponse.data.rows;
          if (rows && rows.length > 0) {
            const row = rows[0];
            watchTime = parseFloat(row[0]?.toString() || '0');
            avgViewDuration = parseFloat(row[1]?.toString() || '0');
            impressions = parseInt(row[2]?.toString() || '0');
            ctr = parseFloat(row[3]?.toString() || '0');
            subscribersGained = parseInt(row[4]?.toString() || '0');
          }
        }
      } catch (analyticsError: any) {
        logger.warn(`YouTube Analytics API unavailable, using basic stats: ${analyticsError.message}`);
      }
    }

    return {
      views: parseInt(stats?.viewCount || '0'),
      likes: parseInt(stats?.likeCount || '0'),
      comments: parseInt(stats?.commentCount || '0'),
      ctr,
      retention,
      watchTime,
      subscribersGained,
      impressions,
      avgViewDuration,
    };
  } catch (error: any) {
    logger.error('Failed to get video analytics', { error: error.message });
    try {
      if (!env.YOUTUBE_API_KEY) return null;
      const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        params: { part: 'statistics', id: videoId, key: env.YOUTUBE_API_KEY },
      });
      const stats = response.data.items?.[0]?.statistics;
      if (!stats) return null;
      return {
        views: parseInt(stats.viewCount || '0'),
        likes: parseInt(stats.likeCount || '0'),
        comments: parseInt(stats.commentCount || '0'),
        ctr: 0, retention: 0, watchTime: 0, subscribersGained: 0,
        impressions: 0, avgViewDuration: 0,
      };
    } catch {
      return null;
    }
  }
}

async function getYouTubeClient(userId?: string) {
  if (userId) {
    try {
      const auth = await getAuthenticatedClient(userId);
      return google.youtube({ version: 'v3', auth });
    } catch {
      // fallback to API key
    }
  }

  if (env.YOUTUBE_API_KEY) {
    return google.youtube({ version: 'v3' });
  }

  throw new Error('YouTube API not configured');
}
