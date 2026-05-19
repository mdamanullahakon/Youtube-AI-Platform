import crypto from 'crypto';
import { getConfigValue } from '../services/config.service';
import { oauthStoreSet, oauthStoreGet } from './oauth-store';

const STATE_TTL_SECONDS = 600;

let cachedSecret: string | null = null;

async function getStateSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const dbVal = await getConfigValue('OAUTH_STATE_SECRET');
  if (dbVal) {
    cachedSecret = dbVal;
    return dbVal;
  }
  const envVal = process.env.OAUTH_STATE_SECRET;
  if (envVal) {
    cachedSecret = envVal;
    return envVal;
  }
  const generated = crypto.randomBytes(32).toString('hex');
  cachedSecret = generated;
  return generated;
}

export interface OAuthStatePayload {
  userId: string;
  nonce: string;
  timestamp: number;
}

export async function generateOAuthState(userId: string): Promise<{ state: string; nonce: string }> {
  const secret = await getStateSecret();
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  const raw = `1.${userId}.${nonce}.${timestamp}`;
  const signature = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const state = `${raw}.${signature}`;
  return { state, nonce };
}

export async function parseOAuthState(state: string): Promise<OAuthStatePayload | null> {
  const parts = state.split('.');
  if (parts.length !== 5) return null;

  const [version, userId, nonce, timestampStr, signature] = parts;
  if (version !== '1') return null;

  const raw = `${version}.${userId}.${nonce}.${timestampStr}`;
  const secret = await getStateSecret();
  const expectedSig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return null;
  }

  const timestamp = parseInt(timestampStr, 10);
  if (Date.now() - timestamp > STATE_TTL_SECONDS * 1000) return null;

  return { userId, nonce, timestamp };
}

export async function markNonceUsed(nonce: string): Promise<boolean> {
  const key = `oauth:nonce:${nonce}`;
  const result = await oauthStoreSet(key, '1', STATE_TTL_SECONDS * 1000, true);
  return result === 'OK';
}

export async function isNonceUsed(nonce: string): Promise<boolean> {
  const key = `oauth:nonce:${nonce}`;
  const result = await oauthStoreGet(key);
  return result !== null;
}
