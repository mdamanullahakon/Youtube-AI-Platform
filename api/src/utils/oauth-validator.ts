import { google } from 'googleapis';
import { logger } from './logger';
import { getConfigValue } from '../services/config.service';
import { env } from '../config/env';

export class OAuthCredentialError extends Error {
  public code: 'DELETED_CLIENT' | 'INVALID_CLIENT' | 'REDIRECT_MISMATCH' | 'INVALID_GRANT' | 'UNKNOWN';

  constructor(code: 'DELETED_CLIENT' | 'INVALID_CLIENT' | 'REDIRECT_MISMATCH' | 'INVALID_GRANT' | 'UNKNOWN', message: string) {
    super(message);
    this.name = 'OAuthCredentialError';
    this.code = code;
  }
}

export class OAuthNotConfiguredError extends Error {
  constructor() {
    super('YouTube OAuth is not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env or via the Setup Wizard.');
    this.name = 'OAuthNotConfiguredError';
  }
}

export interface OAuthValidationResult {
  valid: boolean;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  redirectUriConfigured: boolean;
  redirectUri: string;
  encryptionKeyConfigured: boolean;
  credentialsValid: boolean | null;
  errors: string[];
  warnings: string[];
}

export async function getRedirectUri(): Promise<string> {
  const fromDb = await getConfigValue('YOUTUBE_REDIRECT_URI');
  if (fromDb) return fromDb;
  return env.YOUTUBE_REDIRECT_URI;
}

export function validateRedirectUri(uri: string): string[] {
  const errors: string[] = [];
  try {
    const parsed = new URL(uri);
    if (parsed.pathname.endsWith('/')) {
      errors.push(`Redirect URI has trailing slash: "${uri}". Google requires NO trailing slash. Fix: remove the trailing slash.`);
    }
    if (parsed.protocol === 'http:' && process.env.NODE_ENV === 'production') {
      errors.push(`Redirect URI uses HTTP (${uri}) in production mode. Google requires HTTPS for production OAuth. Fix: change to https://`);
    }
    if (parsed.pathname !== '/api/auth/youtube/callback') {
      errors.push(`Redirect URI path is "${parsed.pathname}" but expected "/api/auth/youtube/callback". Fix: ensure path matches Google Cloud Console exactly.`);
    }
  } catch {
    errors.push(`Redirect URI "${uri}" is not a valid URL. Fix: provide a valid URL like http://localhost:4000/api/auth/youtube/callback`);
  }
  return errors;
}

export async function validateOAuthCredentials(): Promise<OAuthValidationResult> {
  const result: OAuthValidationResult = {
    valid: true,
    clientIdConfigured: false,
    clientSecretConfigured: false,
    redirectUriConfigured: false,
    redirectUri: '',
    encryptionKeyConfigured: false,
    credentialsValid: null,
    errors: [],
    warnings: [],
  };

  const clientId = await getConfigValue('YOUTUBE_CLIENT_ID');
  const clientSecret = await getConfigValue('YOUTUBE_CLIENT_SECRET');
  const redirectUri = await getRedirectUri();
  const encryptionKey = env.ENCRYPTION_KEY;

  result.clientIdConfigured = !!clientId;
  result.clientSecretConfigured = !!clientSecret;
  result.redirectUriConfigured = !!redirectUri;
  result.redirectUri = redirectUri;
  result.encryptionKeyConfigured = !!encryptionKey && encryptionKey.length === 64 && /^[0-9a-f]{64}$/i.test(encryptionKey);

  if (!clientId || !clientSecret) {
    result.valid = false;
    result.errors.push(
      'YouTube OAuth credentials not configured.\n' +
      '  Fix: Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env or via Setup Wizard.\n' +
      '  Steps:\n' +
      '    1. Go to https://console.cloud.google.com/apis/credentials\n' +
      '    2. Create an OAuth 2.0 Client ID (Web application)\n' +
      '    3. Copy Client ID and Client Secret to .env'
    );
    return result;
  }

  if (!redirectUri) {
    result.valid = false;
    result.errors.push(
      'YOUTUBE_REDIRECT_URI is not set.\n' +
      '  Fix: Set YOUTUBE_REDIRECT_URI in .env.\n' +
      `  Local dev: http://localhost:4000/api/auth/youtube/callback\n` +
      '  Production: https://your-api-domain.com/api/auth/youtube/callback\n' +
      '  This MUST match exactly what is registered in Google Cloud Console.'
    );
  } else {
    const uriErrors = validateRedirectUri(redirectUri);
    result.errors.push(...uriErrors);
  }

  if (!encryptionKey) {
    result.warnings.push(
      'ENCRYPTION_KEY is not set.\n' +
      '  YouTube OAuth tokens will NOT be encrypted.\n' +
      '  Fix: Add ENCRYPTION_KEY to .env (64-character hex string).\n' +
      `  Generate: openssl rand -hex 32\n` +
      '  WARNING: If ENCRYPTION_KEY changes after tokens are stored, all tokens become undecryptable!'
    );
  } else if (!/^[0-9a-f]{64}$/i.test(encryptionKey)) {
    result.warnings.push(
      `ENCRYPTION_KEY is set but invalid (must be 64 hex chars, got ${encryptionKey.length} chars).\n` +
      '  Fix: Generate a valid key with: openssl rand -hex 32'
    );
  }

  if (clientId && clientSecret) {
    try {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri || undefined);
      await oauth2Client.getToken({
        code: '__validation_test_invalid__',
        codeVerifier: '__validation_test_invalid__',
      });
    } catch (err: any) {
      const body = err?.response?.data;
      const status = err?.response?.status;
      const errorType = body?.error || err.message || '';

      if (errorType === 'access_denied') {
        result.credentialsValid = null;
        result.warnings.push(
          '⚠ WARNING: OAuth returned "access_denied" during validation.\n' +
          '  This typically means:\n' +
          '  1. The OAuth consent screen is in "Testing" mode and the user is not added as a test user.\n' +
          '     Fix: Go to https://console.cloud.google.com/apis/credentials/consent → "Test users" → "ADD USERS"\n' +
          '  2. OR change publishing status from "Testing" to "In Production" (requires app verification).\n' +
          '  3. The user may have previously denied access. Fix: Go to https://myaccount.google.com/permissions → remove app → retry'
        );
      } else if (errorType === 'deleted_client' || (status === 401 && errorType.includes('deleted'))) {
        result.credentialsValid = false;
        result.warnings.push(
          '⚠ WARNING: deleted_client — Your OAuth client has been DELETED from Google Cloud Console.\n' +
          '  The OAuth flow cannot succeed until new credentials are created.\n' +
          '  Fix:\n' +
          '    1. Go to https://console.cloud.google.com/apis/credentials\n' +
          '    2. Click "Create Credentials" → "OAuth client ID"\n' +
          '    3. Application type: "Web application"\n' +
          '    4. Name: "YouTube AI Platform"\n' +
          '    5. Authorized JavaScript origins:\n' +
          `       ${process.env.FRONTEND_URL || 'http://localhost:3000'}\n` +
          '    6. Authorized redirect URIs:\n' +
          `       ${redirectUri || 'http://localhost:4000/api/auth/youtube/callback'}\n` +
          '    7. Click "Create"\n' +
          '    8. Copy the new Client ID and Client Secret to .env\n' +
          '    9. RESTART THE SERVER'
        );
      } else if (errorType === 'invalid_client' || (status === 401 && errorType.includes('invalid'))) {
        result.valid = false;
        result.credentialsValid = false;
        result.errors.push(
          '❌ ERROR: invalid_client — Your OAuth client ID or secret is INCORRECT.\n' +
          '  Root Cause: YOUTUBE_CLIENT_ID or YOUTUBE_CLIENT_SECRET in .env does not match Google Cloud Console.\n' +
          '  Fix:\n' +
          '    1. Go to https://console.cloud.google.com/apis/credentials\n' +
          '    2. Find your OAuth 2.0 Client ID\n' +
          '    3. Verify Client ID and Client Secret match .env exactly\n' +
          '    4. Re-copy if necessary\n' +
          '    5. RESTART THE SERVER'
        );
      } else if (errorType === 'invalid_grant') {
        result.credentialsValid = true;
        result.warnings.push(
          'YouTube OAuth credentials are VALID (received expected "invalid_grant" from test request).'
        );
      } else if (errorType === 'redirect_uri_mismatch') {
        result.valid = false;
        result.errors.push(
          '❌ ERROR: redirect_uri_mismatch — The redirect URI does not match what is registered in Google Cloud Console.\n' +
          `  Current YOUTUBE_REDIRECT_URI: ${redirectUri}\n` +
          '  Root Cause: The URI above does not match any Authorized Redirect URI in Google Cloud Console.\n' +
          '  Fix:\n' +
          '    1. Go to https://console.cloud.google.com/apis/credentials\n' +
          '    2. Click your OAuth 2.0 Client ID\n' +
          '    3. Under "Authorized redirect URIs", add:\n' +
          `       ${redirectUri}\n` +
          '    4. Click "Save"\n' +
          '    5. WAIT 5 MINUTES for changes to propagate\n' +
          '    6. OR change YOUTUBE_REDIRECT_URI in .env to match what is already registered\n' +
          '  IMPORTANT: The URI must match character-by-character (protocol, host, port, path, NO trailing slash)'
        );
      } else {
        result.credentialsValid = null;
        result.warnings.push(
          `Could not validate OAuth credentials: ${errorType}\n` +
          '  YouTube OAuth may still work. If you encounter errors, check the Google Cloud Console.'
        );
      }
    }
  }

  result.valid = result.errors.length === 0;
  return result;
}

export function formatOAuthReport(result: OAuthValidationResult): string {
  const lines: string[] = [];
  const divider = '═'.repeat(62);

  lines.push('');
  lines.push(`  ╔${divider}╗`);
  lines.push(`  ║  YOUTUBE OAUTH VALIDATION REPORT${' '.repeat(28)}║`);
  lines.push(`  ╚${divider}╝`);
  lines.push('');

  lines.push(`  Client ID     : ${result.clientIdConfigured ? '✓ Configured' : '✗ NOT SET'}`);
  lines.push(`  Client Secret : ${result.clientSecretConfigured ? '✓ Configured' : '✗ NOT SET'}`);
  lines.push(`  Redirect URI  : ${result.redirectUriConfigured ? result.redirectUri : '✗ NOT SET'}`);
  lines.push(`  Encryption Key: ${result.encryptionKeyConfigured ? '✓ Valid (64 hex chars)' : result.redirectUri.includes('not set') ? '✗ NOT SET' : '⚠ Present but may be invalid'}`);
  lines.push(`  Credentials   : ${result.credentialsValid === true ? '✓ Valid' : result.credentialsValid === false ? '✗ INVALID' : result.clientIdConfigured ? '⚠ Not tested' : 'N/A'}`);
  lines.push(`  Overall       : ${result.valid ? '✓ PASSED' : '✗ FAILED'}`);
  lines.push('');

  if (result.errors.length > 0) {
    lines.push(`  ${'─'.repeat(62)}`);
    lines.push(`  ❌ ERRORS (${result.errors.length}):`);
    lines.push(`  ${'─'.repeat(62)}`);
    for (const err of result.errors) {
      lines.push('');
      for (const line of err.split('\n')) {
        lines.push(`  ${line}`);
      }
    }
    lines.push('');
  }

  if (result.warnings.length > 0) {
    lines.push(`  ${'─'.repeat(62)}`);
    lines.push(`  ⚠ WARNINGS (${result.warnings.length}):`);
    lines.push(`  ${'─'.repeat(62)}`);
    for (const warn of result.warnings) {
      lines.push('');
      for (const line of warn.split('\n')) {
        lines.push(`  ${line}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
