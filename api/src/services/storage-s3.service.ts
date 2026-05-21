import { copyFile, rename, unlink, mkdir, readdir, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { logger } from '../utils/logger';
import { STORAGE_CONFIG } from './storage.service';

type StorageType = 'video' | 'voiceover' | 'thumbnail' | 'temp' | 'log';

interface StorageProvider {
  store(key: string, filePath: string): Promise<string>;
  retrieve(key: string, destPath: string): Promise<string>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
}

class LocalStorageProvider implements StorageProvider {
  private resolvePath(key: string): string {
    return join(process.cwd(), key);
  }

  async store(key: string, filePath: string): Promise<string> {
    const dest = this.resolvePath(key);
    const dir = dirname(dest);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await copyFile(filePath, dest);
    logger.info(`LocalStorage: stored ${key} from ${filePath}`);
    return dest;
  }

  async retrieve(key: string, destPath: string): Promise<string> {
    const src = this.resolvePath(key);
    const dir = dirname(destPath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await copyFile(src, destPath);
    logger.info(`LocalStorage: retrieved ${key} to ${destPath}`);
    return destPath;
  }

  async delete(key: string): Promise<boolean> {
    const target = this.resolvePath(key);
    if (!existsSync(target)) return false;
    await unlink(target);
    logger.info(`LocalStorage: deleted ${key}`);
    return true;
  }

  async exists(key: string): Promise<boolean> {
    return existsSync(this.resolvePath(key));
  }

  async list(prefix: string): Promise<string[]> {
    const dir = this.resolvePath(dirname(prefix));
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir);
    return entries.filter(e => e.startsWith(prefix)).map(e => join(dir, e));
  }

  async getSignedUrl(key: string, expiresIn?: number): Promise<string> {
    return this.resolvePath(key);
  }
}

class S3StorageProvider implements StorageProvider {
  async store(key: string, filePath: string): Promise<string> {
    throw new Error('S3 not implemented');
  }

  async retrieve(key: string, destPath: string): Promise<string> {
    throw new Error('S3 not implemented');
  }

  async delete(key: string): Promise<boolean> {
    throw new Error('S3 not implemented');
  }

  async exists(key: string): Promise<boolean> {
    throw new Error('S3 not implemented');
  }

  async list(prefix: string): Promise<string[]> {
    throw new Error('S3 not implemented');
  }

  async getSignedUrl(key: string, expiresIn?: number): Promise<string> {
    throw new Error('S3 not implemented');
  }
}

class StorageS3Service {
  private localProvider = new LocalStorageProvider();
  private s3Provider = new S3StorageProvider();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  getProvider(): StorageProvider {
    const provider = process.env.STORAGE_PROVIDER || 'local';
    if (provider === 's3') return this.s3Provider;
    return this.localProvider;
  }

  async store(type: StorageType, key: string, filePath: string): Promise<string> {
    const basePath = this.getBasePath(type);
    const fullKey = join(basePath, key);
    const provider = this.getProvider();
    return provider.store(fullKey, filePath);
  }

  private getBasePath(type: StorageType): string {
    switch (type) {
      case 'video': return STORAGE_CONFIG.PATHS.VIDEOS;
      case 'voiceover': return STORAGE_CONFIG.PATHS.VOICEOVERS;
      case 'thumbnail': return STORAGE_CONFIG.PATHS.THUMBNAILS;
      case 'temp': return STORAGE_CONFIG.PATHS.TEMP;
      case 'log': return STORAGE_CONFIG.PATHS.LOGS;
    }
  }

  selectCrf(encoder: string, targetSize: 'small' | 'medium' | 'high'): number {
    const crfMap: Record<string, Record<string, number>> = {
      h264_nvenc: { small: 28, medium: 23, high: 18 },
      h264_qsv: { small: 28, medium: 23, high: 18 },
      h264_amf: { small: 28, medium: 23, high: 18 },
      libx264: { small: 28, medium: 23, high: 18 },
    };
    const encoderMap = crfMap[encoder];
    if (!encoderMap) {
      logger.warn(`Unknown encoder ${encoder}, defaulting to libx264 values`);
      return crfMap.libx264[targetSize];
    }
    return encoderMap[targetSize];
  }

  selectPreset(encoder: string): string {
    const gpuEncoders = ['h264_nvenc', 'h264_qsv', 'h264_amf'];
    if (gpuEncoders.includes(encoder)) return 'p7';
    if (encoder === 'libx264') return 'medium';
    logger.warn(`Unknown encoder ${encoder}, defaulting to medium`);
    return 'medium';
  }

  async uploadToCdn(localPath: string, remotePath: string): Promise<string> {
    throw new Error('CDN not configured');
  }

  isCdnConfigured(): boolean {
    return !!(process.env.CDN_ENDPOINT && process.env.CDN_API_KEY);
  }

  scheduleAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    const intervalMs = 30 * 60 * 1000;
    logger.info(`Scheduling auto-cleanup every ${intervalMs / 60000} minutes`);
    this.cleanupInterval = setInterval(() => this.runCleanup(), intervalMs);
  }

  private async runCleanup(): Promise<void> {
    logger.info('Running scheduled auto-cleanup');
    try {
      const tempDir = STORAGE_CONFIG.PATHS.TEMP;
      if (!existsSync(tempDir)) return;

      const entries = await readdir(tempDir);
      const now = Date.now();

      for (const entry of entries) {
        const fullPath = join(tempDir, entry);
        try {
          const s = await stat(fullPath);
          if (!s.isFile() && !s.isDirectory()) continue;

          const ttl = this.getTempTtl(entry);
          if (now - s.mtimeMs > ttl) {
            if (s.isDirectory()) {
              const { rm } = await import('fs/promises');
              await rm(fullPath, { recursive: true, force: true });
            } else {
              await unlink(fullPath);
            }
            logger.debug(`Auto-cleanup removed ${entry}`);
          }
        } catch {
          // skip inaccessible
        }
      }
    } catch (err: any) {
      logger.error('Auto-cleanup failed', { error: err.message });
    }
  }

  getTempTtl(filePath: string): number {
    const name = filePath.toLowerCase();
    if (name.startsWith('render_') || name.startsWith('temp_render_')) {
      return STORAGE_CONFIG.RETENTION.TEMP_RENDER_MS;
    }
    if (name.startsWith('voiceover_') || name.startsWith('tts_')) {
      return STORAGE_CONFIG.RETENTION.VOICEOVER_MS;
    }
    if (name.startsWith('thumbnail_') || name.startsWith('thumb_')) {
      return 24 * 60 * 60 * 1000;
    }
    if (name.startsWith('log_') || name.endsWith('.log')) {
      return STORAGE_CONFIG.RETENTION.LOG_DAYS * 24 * 60 * 60 * 1000;
    }
    return STORAGE_CONFIG.RETENTION.TEMP_RENDER_MS;
  }
}

export const storageS3 = new StorageS3Service();
