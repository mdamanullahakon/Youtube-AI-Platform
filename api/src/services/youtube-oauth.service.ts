import { google, Auth } from 'googleapis';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { getConfigValue } from './config.service';
import { generateOAuthState, parseOAuthState, markNonceUsed } from '../utils/oauth-state';
import { generateCodeVerifier, generateCodeChallenge } from '../utils/pkce';
import { encrypt, decrypt } from '../utils/encryption';
import { OAuthNotConfiguredError, getRedirectUri } from '../utils/oauth-validator';
import { oauthStoreSet, oauthStoreGet, oauthStoreDel } from '../utils/oauth-store';

const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 1000;

const tokenRefreshLocks = new Map<string, Promise<unknown>>();

async function withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  while (tokenRefreshLocks.has(key)) {
    await tokenRefreshLocks.get(key);
  }
  const promise = fn().finally(() => tokenRefreshLocks.delete(key));
  tokenRefreshLocks.set(key, promise);
  return promise;
}

export { OAuthNotConfiguredError };

async function withRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY * Math.pow(2, attempt - 1);
        logger.warn(`${context} failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  logger.error(`${context} failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
  throw lastError;
}

export async function getOAuth2Client() {
  const clientId = await getConfigValue('YOUTUBE_CLIENT_ID');
  const clientSecret = await getConfigValue('YOUTUBE_CLIENT_SECRET');
  const redirectUri = await getRedirectUri();

  if (!clientId || !clientSecret) {
    throw new OAuthNotConfiguredError();
  }

  if (!redirectUri) {
    throw new Error(
      'YOUTUBE_REDIRECT_URI is not set. This MUST match the URI registered in Google Cloud Console exactly.\n' +
      '  Local dev: http://localhost:4000/api/auth/youtube/callback\n' +
      '  Production: https://YOUR_DOMAIN/api/auth/youtube/callback'
    );
  }

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri,
  );
}

export async function generateAuthUrl(userId: string): Promise<{ authUrl: string; state: string }> {
  const oauth2Client = await getOAuth2Client();
  const { state, nonce } = await generateOAuthState(userId);
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const nonceVerifierKey = `oauth:verifier:${nonce}`;
  await oauthStoreSet(nonceVerifierKey, codeVerifier, 600000);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    include_granted_scopes: true,
    state,
    code_challenge_method: Auth.CodeChallengeMethod.S256,
    code_challenge: codeChallenge,
  });

  return { authUrl, state };
}

export async function findOrCreateUserFromGoogle(tokens: Auth.Credentials): Promise<{ id: string; email: string }> {
  const oauth2Client = await getOAuth2Client();
  oauth2Client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const userInfo = await withRetry(
    () => oauth2.userinfo.get(),
    'Fetching Google user profile'
  );

  const email = userInfo.data.email;
  const name = userInfo.data.name || email?.split('@')[0] || 'YouTube User';

  if (!email) {
    throw new Error('Could not retrieve email from Google profile. Ensure the userinfo.email scope is enabled.');
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name,
      password: 'oauth_user_' + Math.random().toString(36).slice(2),
    },
  });

  await Promise.allSettled([
    prisma.settings.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    }),
    prisma.subscription.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    }),
  ]);

  return { id: user.id, email: user.email };
}

export async function handleCallback(code: string, state: string) {
  const payload = await parseOAuthState(state);
  if (!payload) {
    throw new Error('Invalid or expired OAuth state parameter');
  }

  const nonceUsed = await markNonceUsed(payload.nonce);
  if (!nonceUsed) {
    throw new Error('OAuth state has already been used (possible replay attack)');
  }

  const nonceVerifierKey = `oauth:verifier:${payload.nonce}`;
  const codeVerifier = await oauthStoreGet(nonceVerifierKey);
  if (!codeVerifier) {
    throw new Error('PKCE code verifier not found (OAuth flow expired or invalid)');
  }

  return oauthVerifierCleanupGuard(nonceVerifierKey, async () => {
  const userId = payload.userId;

  let user: { id: string; email: string } | null = null;

  const oauth2Client = await getOAuth2Client();
  const { tokens } = await oauth2Client.getToken({ code, codeVerifier });

  if (!tokens.access_token) {
    throw new Error('Missing access_token from Google OAuth response');
  }

  oauth2Client.setCredentials(tokens);

  if (userId && typeof userId === 'string' && userId.trim() !== '') {
    user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  }

  if (!user) {
    logger.info('User not found by state userId — attempting auto-create from Google profile', { userId });
    user = await findOrCreateUserFromGoogle(tokens);
    logger.info('User auto-created/found via Google profile', { userId: user.id, email: user.email });
  }

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  const channelResponse = await withRetry(
    () => youtube.channels.list({ part: ['snippet', 'statistics'], mine: true }),
    'Fetching YouTube channel info'
  );

  const channel = channelResponse.data.items?.[0];
  if (!channel?.id) {
    throw new Error('No YouTube channel found for this account');
  }

  const encryptedAccess = (() => {
    try { return encrypt(tokens.access_token); } catch { return tokens.access_token; }
  })();
  const encryptedRefresh = tokens.refresh_token ? (() => {
    try { return encrypt(tokens.refresh_token); } catch { return tokens.refresh_token; }
  })() : '';

  if (!tokens.expiry_date) {
    logger.warn('Token expiry not provided by Google, defaulting to +1 hour');
  }

  const refreshTokenValue = encryptedRefresh || 'no_refresh_token_provided';

  await prisma.youTubeAccount.upsert({
    where: { userId_channelId: { userId: user.id, channelId: channel.id } },
    update: {
      accessToken: encryptedAccess,
      ...(encryptedRefresh ? { refreshToken: encryptedRefresh } : {}),
      tokenExpiresAt: new Date(tokens.expiry_date || Date.now() + 3600000),
      channelTitle: channel.snippet?.title || undefined,
      channelAvatar: channel.snippet?.thumbnails?.default?.url || undefined,
      isConnected: true,
      lastSyncedAt: new Date(),
      scope: tokens.scope || undefined,
    },
    create: {
      userId: user.id,
      channelId: channel.id,
      channelTitle: channel.snippet?.title || 'Unknown Channel',
      channelAvatar: channel.snippet?.thumbnails?.default?.url || null,
      accessToken: encryptedAccess,
      refreshToken: refreshTokenValue,
      tokenExpiresAt: new Date(tokens.expiry_date || Date.now() + 3600000),
      scope: tokens.scope || SCOPES.join(' '),
    },
  });

  const channelCount = await prisma.youTubeAccount.count({ where: { userId: user.id, isConnected: true } });
  if (channelCount === 1) {
    const account = await prisma.youTubeAccount.findFirst({
      where: { userId: user.id, channelId: channel.id },
      orderBy: { createdAt: 'asc' },
    });
    if (account) {
      await prisma.user.update({
        where: { id: user.id },
        data: { activeChannelId: account.id },
      });
    }
  }

  const account = await prisma.youTubeAccount.findFirst({
    where: { userId: user.id, channelId: channel.id },
  });

  if (account) {
    syncChannelStats(account.id, user.id).catch((err) =>
      logger.warn('Initial channel stats sync failed (non-fatal)', { error: err?.message })
    );
  }

  return {
    userId: user.id,
    channelId: channel.id,
    channelTitle: channel.snippet?.title || 'Unknown Channel',
    channelAvatar: channel.snippet?.thumbnails?.default?.url || null,
    subscriberCount: (channel as any).statistics?.subscriberCount || null,
    videoCount: (channel as any).statistics?.videoCount || null,
  };
  });
}

async function oauthVerifierCleanupGuard<T>(nonceVerifierKey: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    try { await oauthStoreDel(nonceVerifierKey); } catch { /* ignore cleanup error */ }
  }
}

export async function getConnectedChannels(userId: string) {
  const accounts = await prisma.youTubeAccount.findMany({
    where: { userId, isConnected: true },
    select: {
      id: true,
      channelId: true,
      channelTitle: true,
      channelAvatar: true,
      isConnected: true,
      lastSyncedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeChannelId: true },
  });

  return accounts.map(account => ({
    ...account,
    isActive: account.id === user?.activeChannelId,
  }));
}

export async function setActiveChannelForUser(accountId: string, userId: string) {
  const account = await prisma.youTubeAccount.findFirst({
    where: { id: accountId, userId, isConnected: true },
  });
  if (!account) {
    throw new Error('YouTube account not found or not connected');
  }

  await prisma.user.update({
    where: { id: userId },
    data: { activeChannelId: accountId },
  });

  return {
    channelId: account.channelId,
    channelTitle: account.channelTitle,
    isActive: true,
  };
}

export async function getActiveChannelForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeChannelId: true },
  });

  if (!user?.activeChannelId) {
    const firstChannel = await prisma.youTubeAccount.findFirst({
      where: { userId, isConnected: true },
      orderBy: { createdAt: 'asc' },
    });
    if (firstChannel) {
      await prisma.user.update({
        where: { id: userId },
        data: { activeChannelId: firstChannel.id },
      });
      return {
        id: firstChannel.id,
        channelId: firstChannel.channelId,
        channelTitle: firstChannel.channelTitle,
        channelAvatar: firstChannel.channelAvatar,
        isActive: true,
      };
    }
    return null;
  }

  const channel = await prisma.youTubeAccount.findUnique({
    where: { id: user.activeChannelId },
    select: {
      id: true,
      channelId: true,
      channelTitle: true,
      channelAvatar: true,
      isConnected: true,
    },
  });

  if (!channel || !channel.isConnected) {
    const nextChannel = await prisma.youTubeAccount.findFirst({
      where: { userId, isConnected: true },
      orderBy: { createdAt: 'asc' },
    });
    if (nextChannel) {
      await prisma.user.update({
        where: { id: userId },
        data: { activeChannelId: nextChannel.id },
      });
      return {
        id: nextChannel.id,
        channelId: nextChannel.channelId,
        channelTitle: nextChannel.channelTitle,
        channelAvatar: nextChannel.channelAvatar,
        isActive: true,
      };
    }
    return null;
  }

  return {
    id: channel.id,
    channelId: channel.channelId,
    channelTitle: channel.channelTitle,
    channelAvatar: channel.channelAvatar,
    isActive: true,
  };
}

export async function disconnectChannel(accountId: string, userId: string) {
  const account = await prisma.youTubeAccount.findFirst({
    where: { id: accountId, userId },
  });
  if (!account) {
    throw new Error('YouTube account not found');
  }

  await prisma.youTubeAccount.update({
    where: { id: accountId },
    data: { isConnected: false },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeChannelId: true },
  });

  if (user?.activeChannelId === accountId) {
    const nextChannel = await prisma.youTubeAccount.findFirst({
      where: { userId, isConnected: true },
      orderBy: { createdAt: 'asc' },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { activeChannelId: nextChannel?.id || null },
    });
  }

  return { disconnected: true };
}

export async function revokeChannelToken(accountId: string, userId: string) {
  const account = await prisma.youTubeAccount.findFirst({
    where: { id: accountId, userId, isConnected: true },
  });
  if (!account) {
    throw new Error('YouTube account not found or not connected');
  }

  const oauth2Client = await getOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: decrypt(account.refreshToken),
  });

  try {
    await oauth2Client.revokeCredentials();
    logger.info(`Revoked token for channel ${account.channelTitle || account.channelId}`);
  } catch (error: any) {
    logger.warn(`Failed to revoke token for channel ${account.channelTitle || account.channelId}: ${error.message}`);
  }

  await disconnectChannel(accountId, userId);

  return { revoked: true };
}

export async function refreshChannelToken(accountId: string, userId: string) {
  const account = await prisma.youTubeAccount.findFirst({
    where: { id: accountId, userId, isConnected: true },
  });
  if (!account) {
    throw new Error('YouTube account not found');
  }

  const oauth2Client = await getOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: decrypt(account.refreshToken),
  });

  let credentials: any;
  try {
    const result = await withRetry(
      () => oauth2Client.refreshAccessToken(),
      `Refreshing token for channel ${account.channelTitle || account.channelId}`
    );
    credentials = result.credentials;
  } catch (error: any) {
    const body = error?.response?.data;
    const errorType = body?.error || error.message || '';
    if (errorType === 'invalid_grant') {
      logger.warn(`Refresh token invalid for channel ${account.channelTitle || account.channelId} — marking disconnected, reconnect required`);
      await prisma.youTubeAccount.update({
        where: { id: accountId },
        data: { isConnected: false },
      });
      throw new Error(
        `YouTube authorization revoked for "${account.channelTitle || account.channelId}". ` +
        'This usually means the user revoked access via Google Account permissions, or the refresh token expired. ' +
        'Please reconnect the channel by clicking "Connect YouTube Channel" in Settings.'
      );
    }
    throw error;
  }

  if (!credentials.access_token) {
    throw new Error('Token refresh returned no access token');
  }

  const newRefreshToken = credentials.refresh_token
    ? encrypt(credentials.refresh_token)
    : account.refreshToken;

  await prisma.youTubeAccount.update({
    where: { id: accountId },
    data: {
      accessToken: encrypt(credentials.access_token),
      refreshToken: newRefreshToken,
      tokenExpiresAt: new Date(credentials.expiry_date || Date.now() + 3600000),
      lastSyncedAt: new Date(),
    },
  });

  return { refreshed: true };
}

export async function refreshAllChannelTokens(userId: string) {
  const accounts = await prisma.youTubeAccount.findMany({
    where: { userId, isConnected: true },
  });

  const results = [];
  for (const account of accounts) {
    try {
      await refreshChannelToken(account.id, userId);
      results.push({ channelId: account.channelId, status: 'refreshed' });
    } catch (error: any) {
      logger.error(`Failed to refresh token for channel ${account.channelId}`, { error: error.message });
      results.push({ channelId: account.channelId, status: 'failed', error: error.message });
    }
  }

  return results;
}

export async function getAuthenticatedClient(userId: string, channelId?: string) {
  const where: any = { userId, isConnected: true };
  if (channelId) {
    where.channelId = channelId;
  } else {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeChannelId: true },
    });
    if (user?.activeChannelId) {
      where.id = user.activeChannelId;
    }
  }

  const account = await prisma.youTubeAccount.findFirst({ where });
  if (!account) {
    throw new Error('No connected YouTube account found. Please connect your YouTube channel first.');
  }

  if (Date.now() >= account.tokenExpiresAt.getTime() - 300000) {
    await withMutex(`refresh:${account.id}`, async () => {
      const latest = await prisma.youTubeAccount.findUnique({ where: { id: account.id } });
      if (latest && Date.now() >= latest.tokenExpiresAt.getTime() - 300000) {
        await refreshChannelToken(account.id, userId);
      }
    });
  }

  const refreshed = await prisma.youTubeAccount.findUnique({ where: { id: account.id } });
  if (!refreshed) throw new Error('Failed to read account after token refresh');

  const oauth2Client = await getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: decrypt(refreshed.accessToken),
    refresh_token: decrypt(refreshed.refreshToken),
  });
  return oauth2Client;
}

export async function getReconnectNeededChannels(userId: string) {
  const accounts = await prisma.youTubeAccount.findMany({
    where: { userId, isConnected: false },
    select: {
      id: true,
      channelId: true,
      channelTitle: true,
      channelAvatar: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return accounts;
}

export async function syncChannelStats(accountId: string, userId: string) {
  try {
    const oauth2Client = await getAuthenticatedClient(userId);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const response = await withRetry(
      () => youtube.channels.list({ part: ['snippet', 'statistics'], mine: true }),
      `Syncing channel stats for account ${accountId}`
    );

    const channel = response.data.items?.[0];
    if (!channel?.id) {
      logger.warn('No channel data returned during stats sync', { accountId });
      return null;
    }

    const stats = channel.statistics;
    if (!stats) {
      logger.warn('No statistics returned for channel', { channelId: channel.id });
      return null;
    }

    await prisma.channelMetrics.create({
      data: {
        channelId: channel.id,
        userId,
        subscribers: parseInt(stats.subscriberCount || '0'),
        totalViews: parseInt(stats.viewCount || '0'),
        totalVideos: parseInt(stats.videoCount || '0'),
        collectedAt: new Date(),
      },
    });

    await prisma.youTubeAccount.update({
      where: { id: accountId },
      data: { lastSyncedAt: new Date() },
    });

    logger.info('Channel stats synced', {
      channelId: channel.id,
      subscribers: stats.subscriberCount,
      videos: stats.videoCount,
    });

    return {
      subscriberCount: parseInt(stats.subscriberCount || '0'),
      videoCount: parseInt(stats.videoCount || '0'),
      viewCount: parseInt(stats.viewCount || '0'),
    };
  } catch (error: any) {
    logger.error('Failed to sync channel stats', { accountId, error: error.message });
    return null;
  }
}

export async function syncAllUsersChannelStats() {
  logger.info('Starting scheduled channel stats sync for all users');

  const accounts = await prisma.youTubeAccount.findMany({
    where: { isConnected: true },
    select: { id: true, userId: true },
  });

  let synced = 0;
  let failed = 0;

  for (const account of accounts) {
    try {
      const result = await syncChannelStats(account.id, account.userId);
      if (result) synced++;
      else failed++;
    } catch (error: any) {
      failed++;
      logger.error('Scheduled sync failed for account', { accountId: account.id, error: error.message });
    }
  }

  logger.info('Scheduled channel stats sync complete', { total: accounts.length, synced, failed });
}

export async function getOAuthStatus(userId?: string) {
  const clientId = await getConfigValue('YOUTUBE_CLIENT_ID');
  const clientSecret = await getConfigValue('YOUTUBE_CLIENT_SECRET');
  const refreshToken = await getConfigValue('YOUTUBE_REFRESH_TOKEN');

  let reconnectNeeded = null;
  if (userId) {
    reconnectNeeded = await getReconnectNeededChannels(userId);
  }

  return {
    clientIdConfigured: !!clientId,
    clientSecretConfigured: !!clientSecret,
    refreshTokenConfigured: !!refreshToken,
    fullyConfigured: !!clientId && !!clientSecret && !!refreshToken,
    reconnectNeeded,
  };
}
