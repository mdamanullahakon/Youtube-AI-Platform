import { Request, Response } from 'express';
import { logger } from '../utils/logger';
import {
  generateAuthUrl,
  handleCallback,
  getConnectedChannels,
  disconnectChannel,
  refreshChannelToken,
  getOAuthStatus,
  setActiveChannelForUser,
  getActiveChannelForUser,
  revokeChannelToken,
  refreshAllChannelTokens,
  getReconnectNeededChannels,
  OAuthNotConfiguredError,
} from '../services/youtube-oauth.service';
import { validateOAuthCredentials } from '../utils/oauth-validator';
import { env } from '../config/env';

interface AuthRequest extends Request {
  userId?: string;
}

function getPrimaryFrontendUrl(raw: string): string {
  return raw.split(',')[0].trim();
}

export async function connectYouTube(req: AuthRequest, res: Response) {
  try {
    const validation = await validateOAuthCredentials();
    if (validation.credentialsValid === false) {
      return res.status(400).json({
        success: false,
        message: 'YouTube OAuth client has been deleted. New credentials must be created in Google Cloud Console.',
        code: 'DELETED_CLIENT',
        warnings: validation.warnings,
        fixUrl: 'https://console.cloud.google.com/apis/credentials',
      });
    }
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: 'YouTube OAuth is not properly configured.',
        code: 'OAUTH_CONFIG_ERROR',
        errors: validation.errors,
        fixUrl: '/setup',
      });
    }

    const userId = req.userId!;
    const { authUrl, state } = await generateAuthUrl(userId);
    res.json({ success: true, authUrl, state });
  } catch (error: any) {
    if (error instanceof OAuthNotConfiguredError) {
      return res.status(400).json({ success: false, message: error.message, code: 'OAUTH_NOT_CONFIGURED' });
    }
    logger.error('Failed to generate YouTube auth URL', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to initiate YouTube connection' });
  }
}

const FRONTEND_URL = getPrimaryFrontendUrl(env.FRONTEND_URL);

export async function youtubeCallback(req: Request, res: Response) {
  try {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const oauthError = req.query.error as string | undefined;

    logger.info('YouTube OAuth callback received', {
      hasCode: !!code,
      codePreview: code ? code.substring(0, 20) + '...' : undefined,
      statePreview: state ? state.substring(0, 20) + '...' : undefined,
      oauthError: oauthError || undefined,
      redirectTarget: FRONTEND_URL,
    });

    if (oauthError) {
      logger.error('YouTube OAuth error from Google', { error: oauthError });
      const errorMessages: Record<string, string> = {
        access_denied: 'Access denied. If you cancelled the consent screen, try again and grant access. If the error persists, go to https://myaccount.google.com/permissions, remove this app, and retry. If still blocked, the OAuth consent screen is in "Testing" mode — the developer must add your email as a test user in Google Cloud Console (https://console.cloud.google.com/apis/credentials/consent → Test users).',
        redirect_uri_mismatch: 'OAuth redirect URI mismatch. Contact support.',
        deleted_client: 'YouTube OAuth client has been deleted. Please reconnect via Setup Wizard.',
        invalid_client: 'YouTube OAuth client is invalid. Please reconnect via Setup Wizard.',
      };
      const humanReason = errorMessages[oauthError] || `Google OAuth error: ${oauthError}`;
      const redirectUrl = `${FRONTEND_URL}/dashboard/settings?youtube=error&reason=${encodeURIComponent(humanReason)}`;
      logger.info('Redirecting (OAuth error)', { redirectUrl });
      return res.redirect(redirectUrl);
    }

    if (!code || !state) {
      const redirectUrl = `${FRONTEND_URL}/dashboard/settings?youtube=error&reason=missing_params`;
      logger.warn('Missing code/state in OAuth callback', { hasCode: !!code, hasState: !!state, redirectUrl });
      return res.redirect(redirectUrl);
    }

    const channel = await handleCallback(code, state);
    logger.info(`YouTube channel connected: ${channel.channelTitle}`, { channelId: channel.channelId });

    const params = new URLSearchParams({
      youtube: 'connected',
      channel: channel.channelTitle || '',
      channelId: channel.channelId,
      userId: channel.userId,
    });
    if (channel.subscriberCount) params.set('subscribers', String(channel.subscriberCount));
    if (channel.videoCount) params.set('videos', String(channel.videoCount));

    const redirectUrl = `${FRONTEND_URL}/dashboard/settings?${params.toString()}`;
    logger.info('Redirecting (OAuth success)', { redirectUrl, channelTitle: channel.channelTitle, channelId: channel.channelId });
    res.redirect(redirectUrl);
  } catch (error: any) {
    logger.error('YouTube OAuth callback failed', { error: error.message, stack: error.stack });
    const reason = encodeURIComponent(error.message || 'Unknown error');
    const redirectUrl = `${FRONTEND_URL}/dashboard/settings?youtube=error&reason=${reason}`;
    logger.info('Redirecting (OAuth error after catch)', { redirectUrl });
    res.redirect(redirectUrl);
  }
}

export async function getChannels(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const channels = await getConnectedChannels(userId);
    res.json({ success: true, channels });
  } catch (error: any) {
    logger.error('Failed to get channels', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get connected channels' });
  }
}

export async function getActiveChannel(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const channel = await getActiveChannelForUser(userId);
    res.json({ success: true, channel });
  } catch (error: any) {
    logger.error('Failed to get active channel', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get active channel' });
  }
}

export async function setActiveChannel(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const accountId = req.params.accountId as string;
    const channel = await setActiveChannelForUser(accountId, userId);
    res.json({ success: true, channel, message: 'Active channel updated' });
  } catch (error: any) {
    logger.error('Failed to set active channel', { error: error.message });
    res.status(400).json({ success: false, message: error.message || 'Failed to set active channel' });
  }
}

export async function disconnectYouTube(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const accountId = req.params.accountId as string;
    const result = await disconnectChannel(accountId, userId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error('Failed to disconnect channel', { error: error.message });
    res.status(500).json({ success: false, message: error.message || 'Failed to disconnect channel' });
  }
}

export async function revokeChannel(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const accountId = req.params.accountId as string;
    const result = await revokeChannelToken(accountId, userId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error('Failed to revoke channel token', { error: error.message });
    res.status(500).json({ success: false, message: error.message || 'Failed to revoke channel token' });
  }
}

export async function refreshToken(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const accountId = req.params.accountId as string;
    const result = await refreshChannelToken(accountId, userId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error('Failed to refresh token', { error: error.message });
    res.status(500).json({ success: false, message: error.message || 'Failed to refresh token' });
  }
}

export async function refreshAllTokens(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const results = await refreshAllChannelTokens(userId);
    res.json({ success: true, results });
  } catch (error: any) {
    logger.error('Failed to refresh all tokens', { error: error.message });
    res.status(500).json({ success: false, message: error.message || 'Failed to refresh all tokens' });
  }
}

export async function oauthStatus(req: AuthRequest, res: Response) {
  try {
    const status = await getOAuthStatus(req.userId);
    res.json({ success: true, data: status });
  } catch (error: any) {
    logger.error('Failed to get OAuth status', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get OAuth status' });
  }
}

export async function getReconnectNeeded(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const channels = await getReconnectNeededChannels(userId);
    res.json({ success: true, channels });
  } catch (error: any) {
    logger.error('Failed to get reconnect-needed channels', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get reconnect-needed channels' });
  }
}
