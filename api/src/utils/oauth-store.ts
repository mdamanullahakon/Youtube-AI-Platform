import { redisConnection } from '../config/redis';
import { logger } from './logger';

interface StoreEntry {
  value: string;
  expiresAt: number;
}

class MemoryStore {
  private store = new Map<string, StoreEntry>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  async set(key: string, value: string, ttlMs: number, nx?: boolean): Promise<'OK' | null> {
    if (nx && this.store.has(key)) {
      return null;
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

let memoryStore: MemoryStore | null = null;

function getMemoryStore(): MemoryStore {
  if (!memoryStore) {
    memoryStore = new MemoryStore();
  }
  return memoryStore;
}

export async function oauthStoreSet(key: string, value: string, ttlMs: number, nx?: boolean): Promise<'OK' | null> {
  try {
    if (nx) {
      return await redisConnection.set(key, value, 'PX', ttlMs, 'NX') as 'OK' | null;
    }
    await redisConnection.set(key, value, 'PX', ttlMs);
    return 'OK';
  } catch {
    logger.warn(`Redis unavailable — falling back to memory store for key: ${key.split(':')[0]}:...`);
    return getMemoryStore().set(key, value, ttlMs, nx);
  }
}

export async function oauthStoreGet(key: string): Promise<string | null> {
  try {
    return await redisConnection.get(key);
  } catch {
    return getMemoryStore().get(key);
  }
}

export async function oauthStoreDel(key: string): Promise<void> {
  try {
    await redisConnection.del(key);
  } catch {
    getMemoryStore().del(key);
  }
}
