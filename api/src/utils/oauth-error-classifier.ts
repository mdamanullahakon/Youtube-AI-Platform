import { env } from '../config/env';

export type OAuthFailureType =
  | 'A_deleted_client'
  | 'B_redirect_uri_mismatch'
  | 'C_scope_permission'
  | 'D_consent_screen'
  | 'E_quota_disabled'
  | 'F_token_expired'
  | 'G_unknown';

export interface ClassifiedOAuthError {
  type: OAuthFailureType;
  title: string;
  rootCause: string;
  fixSteps: string[];
  copyPasteConfig: Record<string, string>;
  incomeSafe: boolean;
  blockSystem: boolean;
}

const GOOGLE_CLOUD_CONSOLE_URL = 'https://console.cloud.google.com/apis/credentials';
const GOOGLE_CLOUD_LIBRARY_URL = 'https://console.cloud.google.com/apis/library';
const YOUTUBE_API_SERVICE_NAME = 'YouTube Data API v3';

export function classifyOAuthError(error: any): ClassifiedOAuthError {
  const body = error?.response?.data || {};
  const status = error?.response?.status || 0;
  const errorType = body?.error || '';
  const errorDesc = body?.error_description || '';
  const message = error?.message || '';

  const redirectUri = env.YOUTUBE_REDIRECT_URI;
  const frontendUrl = env.FRONTEND_URL;

  // ─── A: deleted_client / invalid_client ────────────────────────────
  if (errorType === 'deleted_client' || (status === 401 && message.includes('deleted'))) {
    return {
      type: 'A_deleted_client',
      title: 'OAuth Client Deleted or Invalid',
      rootCause: 'The OAuth 2.0 Client ID or Secret in .env is no longer valid in Google Cloud Console. The client was either deleted or the credentials were rotated.',
      fixSteps: [
        `1. Open Google Cloud Console: ${GOOGLE_CLOUD_CONSOLE_URL}`,
        '2. Find your OAuth 2.0 Client ID under "OAuth 2.0 Client IDs"',
        '3. If it shows "DELETED" status:',
        '   a. Click "Create Credentials" → "OAuth client ID"',
        '   b. Application type: "Web application"',
        '   c. Name: "YouTube AI Platform"',
        '   d. Add Authorized JavaScript origins:',
        `      ${frontendUrl}`,
        '   e. Add Authorized redirect URIs:',
        `      ${redirectUri}`,
        '   f. Click "Create"',
        '   g. Copy the new Client ID and Client Secret',
        '4. If it exists but credentials are wrong:',
        '   a. Click the pencil/edit icon on your client',
        '   b. Copy the correct Client ID and Client Secret',
        '5. Update .env with the new values',
        `   YOUTUBE_CLIENT_ID=<new-client-id>` + (redirectUri ? '' : ''),
        `   YOUTUBE_CLIENT_SECRET=<new-client-secret>` + (redirectUri ? '' : ''),
        '6. RESTART THE SERVER',
      ],
      copyPasteConfig: {
        YOUTUBE_CLIENT_ID: '<your-client-id>.apps.googleusercontent.com',
        YOUTUBE_CLIENT_SECRET: 'GOCSPX-<your-secret>',
        YOUTUBE_REDIRECT_URI: redirectUri,
        FRONTEND_URL: frontendUrl,
      },
      incomeSafe: true,
      blockSystem: false,
    };
  }

  // ─── B: redirect_uri_mismatch ──────────────────────────────────────
  if (errorType === 'redirect_uri_mismatch' || message.includes('redirect_uri_mismatch')) {
    return {
      type: 'B_redirect_uri_mismatch',
      title: 'Redirect URI Mismatch',
      rootCause: `The callback URI (${redirectUri}) does not match any Authorized Redirect URI registered in Google Cloud Console. Google compares character-by-character — protocol, host, port, path, and NO trailing slash.`,
      fixSteps: [
        `1. Go to: ${GOOGLE_CLOUD_CONSOLE_URL}`,
        '2. Click your OAuth 2.0 Client ID',
        '3. Under "Authorized redirect URIs", verify this EXACT URI is listed:',
        `   ${redirectUri}`,
        '4. If missing, add it and click "Save"',
        '5. WAIT 5 MINUTES for Google to propagate the change',
        '6. If still failing, the URI in your .env may not match:',
        '   - Check for trailing slash (remove it)',
        '   - Check http vs https',
        '   - Check port number (:4000 vs :3000)',
        '   - Check full path (/api/auth/youtube/callback)',
        `7. Copy-paste this EXACT URI into Google Cloud Console:`,
        `   ${redirectUri}`,
      ],
      copyPasteConfig: {
        YOUTUBE_REDIRECT_URI: redirectUri,
        'Google Console → Authorized redirect URIs': redirectUri,
      },
      incomeSafe: true,
      blockSystem: false,
    };
  }

  // ─── C: scope / permission error ──────────────────────────────────
  const scopeErrors = ['access_not_granted', 'insufficient_permissions', 'scope'];
  const isScopeError = scopeErrors.some(s =>
    errorType.toLowerCase().includes(s) || message.toLowerCase().includes(s)
  );

  if (isScopeError || (status === 403 && message.includes('permission'))) {
    return {
      type: 'C_scope_permission',
      title: 'Missing YouTube API Scopes',
      rootCause: 'The OAuth consent screen does not request the required YouTube API scopes. The user may have denied specific permissions, or the app registration is missing scopes.',
      fixSteps: [
        '1. Go to: https://console.cloud.google.com/apis/credentials/consent',
        '2. Under "Scopes for Google APIs", click "ADD OR REMOVE SCOPES"',
        '3. Add these MANUALLY (they may not appear in the dropdown):',
        '   https://www.googleapis.com/auth/youtube',
        '   https://www.googleapis.com/auth/youtube.upload',
        '   https://www.googleapis.com/auth/youtube.readonly',
        '   https://www.googleapis.com/auth/userinfo.email',
        '4. Click "Update" and "Save"',
        '5. If scopes are "sensitive", your app needs Google verification',
        '   for production. For development/testing, add test users instead.',
        '6. In the OAuth consent screen, ensure "Publishing status" is',
        '   "Testing" (not "In production") if app is unverified.',
        '7. Add ALL test user emails under "Test users"',
        '8. Users who already denied must revoke access and re-authenticate:',
        '   https://myaccount.google.com/permissions',
      ],
      copyPasteConfig: {
        'Required Scopes': [
          'https://www.googleapis.com/auth/youtube',
          'https://www.googleapis.com/auth/youtube.upload',
          'https://www.googleapis.com/auth/youtube.readonly',
          'https://www.googleapis.com/auth/userinfo.email',
        ].join('\n                   '),
      },
      incomeSafe: true,
      blockSystem: false,
    };
  }

  // ─── D: consent screen / testing mode ──────────────────────────────
  const consentErrors = ['consent_required', 'access_denied', 'disallowed_useragent'];
  const isConsentError = consentErrors.some(s =>
    errorType.toLowerCase().includes(s) || message.toLowerCase().includes(s)
  );
  if (isConsentError || errorType === 'access_denied') {
    return {
      type: 'D_consent_screen',
      title: 'OAuth Consent Screen Issue',
      rootCause: errorType === 'access_denied'
        ? 'The user denied the authorization request. No tokens were issued.'
        : 'The OAuth consent screen is not properly configured. The app may be in "Testing" mode and the user is not added as a test user, or the app is unverified.',
      fixSteps: [
        '1. Go to: https://console.cloud.google.com/apis/credentials/consent',
        '2. Check "Publishing status":',
        '   - If "Testing": All test users must be added manually',
        '   - If "In production": App must be verified by Google',
        '3. If in Testing mode:',
        '   a. Scroll to "Test users" section',
        '   b. Click "ADD USERS"',
        '   c. Add the Google account email that is trying to connect',
        '   d. Click "Save"',
        '4. If user denied access:',
        '   a. Go to https://myaccount.google.com/permissions',
        '   b. Find this app and click "Remove Access"',
        '   c. Try connecting again — consent screen will reappear',
      ],
      copyPasteConfig: {
        'Google Cloud → OAuth consent screen URL': 'https://console.cloud.google.com/apis/credentials/consent',
        'User permission manager URL': 'https://myaccount.google.com/permissions',
      },
      incomeSafe: true,
      blockSystem: false,
    };
  }

  // ─── E: quota / API disabled ──────────────────────────────────────
  const quotaErrors = ['quota_exceeded', 'rateLimitExceeded', 'dailyLimitExceeded', 'accessNotConfigured'];
  const isQuotaError = quotaErrors.some(s =>
    errorType.includes(s) || message.includes(s) || errorDesc.includes(s)
  );
  const isApiNotEnabled = errorType === 'accessNotConfigured' || (status === 403 && (message.includes('not enabled') || message.includes('accessNotConfigured')));

  if (isQuotaError || isApiNotEnabled) {
    return {
      type: 'E_quota_disabled',
      title: isApiNotEnabled ? 'YouTube Data API Not Enabled' : 'YouTube API Quota Exceeded',
      rootCause: isApiNotEnabled
        ? 'The YouTube Data API v3 is not enabled for this Google Cloud project. API calls are rejected at the project level.'
        : 'The YouTube Data API v3 quota has been exceeded for this project. Default quota is 10,000 units per day.',
      fixSteps: isApiNotEnabled ? [
        `1. Go to: ${GOOGLE_CLOUD_LIBRARY_URL}`,
        `2. Search for "${YOUTUBE_API_SERVICE_NAME}"`,
        '3. Click the API and click "ENABLE"',
        '4. Wait 2-5 minutes for activation to propagate',
        '5. Also enable these related APIs:',
        '   - YouTube Analytics API (for analytics)',
        '   - YouTube Reporting API (for reports)',
      ] : [
        '1. Go to: https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas',
        '2. Current quota: 10,000 units/day (default)',
        '3. To increase: Submit a quota increase request',
        '4. To optimize:',
        '   - Reduce polling frequency in analytics workers',
        '   - Cache API responses where possible',
        '   - Use API key for read-only operations instead of OAuth',
        '5. Wait until quota resets (midnight Pacific Time)',
      ],
      copyPasteConfig: {
        'YouTube Data API URL': 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
        'Quota page URL': 'https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas',
      },
      incomeSafe: true,
      blockSystem: false,
    };
  }

  // ─── F: token expired / invalid_grant ──────────────────────────────
  if (errorType === 'invalid_grant' || status === 401 || message.includes('invalid_grant') || message.includes('Token has expired')) {
    return {
      type: 'F_token_expired',
      title: 'OAuth Token Expired or Invalid',
      rootCause: 'The stored refresh token is invalid, expired, or has been revoked by the user. YouTube OAuth refresh tokens do not expire unless the user revokes access or the app is re-configured.',
      fixSteps: [
        '1. User must reconnect their YouTube channel:',
        '   a. Go to Dashboard → Settings',
        '   b. Click "Disconnect" on the affected channel',
        '   c. Click "Connect YouTube Channel"',
        '   d. Complete the OAuth flow again',
        '2. If using YOUTUBE_REFRESH_TOKEN from .env:',
        '   a. Generate a new refresh token',
        '   b. Update .env with the new token',
        '3. If OAuth client was recreated:',
        '   - All existing refresh tokens are invalidated',
        '   - Users must re-authenticate via Settings',
      ],
      copyPasteConfig: {},
      incomeSafe: true,
      blockSystem: false,
    };
  }

  // ─── G: unknown ───────────────────────────────────────────────────
  return {
    type: 'G_unknown',
    title: `Unknown OAuth Error (${errorType || status || 'no details'})`,
    rootCause: `Unrecognized error from Google: ${errorType} — ${errorDesc || message}. Status code: ${status}.`,
    fixSteps: [
      '1. Check the server logs for the full error response',
      '2. Verify all .env variables are set correctly:',
      '   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET,',
      '   YOUTUBE_REDIRECT_URI, ENCRYPTION_KEY',
      '3. Check Google Cloud Console → APIs & Services → Credentials',
      '4. Check Google Cloud Console → APIs & Services → Library',
      `   Ensure "${YOUTUBE_API_SERVICE_NAME}" is enabled`,
      '5. Visit the Google OAuth debugger:',
      '   https://developers.google.com/oauthplayground/',
      '6. If the error persists, check the network request details',
      '   and search for the error code at:',
      '   https://developers.google.com/youtube/v3/docs/errors',
    ],
    copyPasteConfig: {
      'OAuth Debugger': 'https://developers.google.com/oauthplayground/',
      'YouTube API Errors': 'https://developers.google.com/youtube/v3/docs/errors',
    },
    incomeSafe: true,
    blockSystem: false,
  };
}

export function formatOAuthErrorForUser(error: ClassifiedOAuthError): string {
  const lines: string[] = [];

  lines.push(`┌─────────────────────────────────────────────────┐`);
  lines.push(`│  ❌ ERROR: ${error.title.padEnd(41)}│`);
  lines.push(`└─────────────────────────────────────────────────┘`);
  lines.push(``);
  lines.push(`  Type   : ${error.type}`);
  lines.push(`  System : ${error.blockSystem ? '⛔ BLOCKED' : '✓ Income Safe'}`);
  lines.push(``);
  lines.push(`  🔍 Root Cause:`);
  lines.push(`  ${error.rootCause}`);
  lines.push(``);
  lines.push(`  🧨 Fix Steps:`);
  for (const step of error.fixSteps) {
    lines.push(`  ${step}`);
  }

  if (Object.keys(error.copyPasteConfig).length > 0) {
    lines.push(``);
    lines.push(`  📌 Copy-Paste Config:`);
    for (const [key, value] of Object.entries(error.copyPasteConfig)) {
      lines.push(`  ${key}=${value}`);
    }
  }

  lines.push(``);
  lines.push(`  💰 Income Safety: ${error.incomeSafe ? 'ACTIVE' : 'DISABLED'}`);
  if (error.incomeSafe) {
    lines.push(`  The system continues to generate scripts, thumbnails, and SEO.`);
    lines.push(`  Videos are queued for upload once YouTube is reconnected.`);
  }

  return lines.join('\n');
}
