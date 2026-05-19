import { exec } from 'child_process';
import { promisify } from 'util';
import { readdir, stat, unlink, rm, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { existsSync } from 'fs';
import { logger } from '../utils/logger';

// ─── Configuration ────────────────────────────────
export const STORAGE_CONFIG = {
  PATHS: {
    TEMP: join(process.cwd(), 'temp'),
    UPLOADS: join(process.cwd(), 'uploads'),
    VIDEOS: join(process.cwd(), 'uploads', 'videos'),
    VOICEOVERS: join(process.cwd(), 'uploads', 'voiceovers'),
    THUMBNAILS: join(process.cwd(), 'uploads', 'thumbnails'),
    LOGS: join(process.cwd(), 'logs'),
  },
  RETENTION: {
    TEMP_RENDER_MS: 60 * 60 * 1000,          // 1 hour
    VOICEOVER_MS: 30 * 24 * 60 * 60 * 1000,  // 30 days
    VIDEO_AFTER_UPLOAD_MS: 14 * 24 * 60 * 60 * 1000, // 14 days post-upload
    LOG_DAYS: 7,
  },
  THRESHOLDS: {
    CRITICAL_BYTES: 500 * 1024 * 1024,       // 500 MB
    WARNING_BYTES: 1024 * 1024 * 1024,        // 1 GB
    MAX_TEMP_BYTES: 2 * 1024 * 1024 * 1024,   // 2 GB temp limit
  },
};

interface DirInfo {
  path: string;
  size: number;
  files: number;
}

export interface StorageUsage {
  total: DirInfo;
  temp: DirInfo;
  videos: DirInfo;
  voiceovers: DirInfo;
  thumbnails: DirInfo;
  logs: DirInfo;
  freeBytes: number;
  freeFormatted: string;
  status: 'ok' | 'warning' | 'critical';
}

interface CleanupResult {
  freedBytes: number;
  freedFormatted: string;
  filesRemoved: number;
  details: string[];
}

async function getDirSize(dirPath: string): Promise<DirInfo> {
  const result: DirInfo = { path: dirPath, size: 0, files: 0 };
  try {
    if (!existsSync(dirPath)) return result;
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          const sub = await getDirSize(fullPath);
          result.size += sub.size;
          result.files += sub.files;
        } else if (entry.isFile()) {
          const s = await stat(fullPath);
          result.size += s.size;
          result.files += 1;
        }
      } catch { /* skip inaccessible */ }
    }
  } catch { /* skip missing */ }
  return result;
}

const execAsync = promisify(exec);

export async function getDiskFree(): Promise<{ free: number; total: number }> {
  try {
    if (process.platform === 'win32') {
      const drive = process.cwd().split(':')[0] + ':';
      const { stdout } = await execAsync(`wmic logicaldisk where "DeviceID='${drive}'" get FreeSpace,Size /format:csv`);
      const lines = stdout.trim().split('\n');
      if (lines.length > 1) {
        const parts = lines[1].split(',');
        return { free: parseInt(parts[1] || '0', 10), total: parseInt(parts[2] || '0', 10) };
      }
    } else {
      const { stdout } = await execAsync('df -k . | tail -1');
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 4) {
        return { free: parseInt(parts[3], 10) * 1024, total: parseInt(parts[1], 10) * 1024 };
      }
    }
  } catch { /* fallback */ }
  return { free: 0, total: 0 };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

function isOlderThan(filePath: string, ageMs: number): Promise<boolean> {
  return stat(filePath).then(s => Date.now() - s.mtimeMs > ageMs).catch(() => false);
}

function isOlderThanDays(filePath: string, days: number): Promise<boolean> {
  return isOlderThan(filePath, days * 24 * 60 * 60 * 1000);
}

export class StorageManager {

  static async getUsage(): Promise<StorageUsage> {
    const [temp, videos, voiceovers, thumbnails, logs, disk] = await Promise.all([
      getDirSize(STORAGE_CONFIG.PATHS.TEMP),
      getDirSize(STORAGE_CONFIG.PATHS.VIDEOS),
      getDirSize(STORAGE_CONFIG.PATHS.VOICEOVERS),
      getDirSize(STORAGE_CONFIG.PATHS.THUMBNAILS),
      getDirSize(STORAGE_CONFIG.PATHS.LOGS),
      getDiskFree(),
    ]);

    const totalSize = temp.size + videos.size + voiceovers.size + thumbnails.size + logs.size;

    let status: 'ok' | 'warning' | 'critical' = 'ok';
    if (disk.free < STORAGE_CONFIG.THRESHOLDS.CRITICAL_BYTES) status = 'critical';
    else if (disk.free < STORAGE_CONFIG.THRESHOLDS.WARNING_BYTES) status = 'warning';

    return {
      total: { path: 'total', size: totalSize, files: temp.files + videos.files + voiceovers.files + thumbnails.files + logs.files },
      temp,
      videos,
      voiceovers,
      thumbnails,
      logs,
      freeBytes: disk.free,
      freeFormatted: formatBytes(disk.free),
      status,
    };
  }

  static async cleanupTempRenders(): Promise<CleanupResult> {
    const details: string[] = [];
    let freedBytes = 0;
    let filesRemoved = 0;

    try {
      if (!existsSync(STORAGE_CONFIG.PATHS.TEMP)) {
        return { freedBytes: 0, freedFormatted: '0 B', filesRemoved: 0, details: ['No temp directory'] };
      }

      const entries = await readdir(STORAGE_CONFIG.PATHS.TEMP);
      for (const entry of entries) {
        const fullPath = join(STORAGE_CONFIG.PATHS.TEMP, entry);
        try {
          const s = await stat(fullPath);
          if (!s.isDirectory()) continue;

          const isOld = Date.now() - s.mtimeMs > STORAGE_CONFIG.RETENTION.TEMP_RENDER_MS;
          if (!isOld) continue;

          const dirSize = await getDirSize(fullPath);
          await rm(fullPath, { recursive: true, force: true });
          freedBytes += dirSize.size;
          filesRemoved += dirSize.files;
          details.push(`Removed old render: ${entry} (${formatBytes(dirSize.size)})`);
        } catch { /* skip */ }
      }
    } catch (err: any) {
      logger.error('Temp render cleanup failed', { error: err.message });
    }

    return {
      freedBytes,
      freedFormatted: formatBytes(freedBytes),
      filesRemoved,
      details,
    };
  }

  static async cleanupVoiceovers(): Promise<CleanupResult> {
    return StorageManager.cleanupAgedFiles(
      STORAGE_CONFIG.PATHS.VOICEOVERS,
      STORAGE_CONFIG.RETENTION.VOICEOVER_MS,
      ['.mp3', '.wav', '.ogg', '.flac'],
      'voiceover',
    );
  }

  static async cleanupLogs(): Promise<CleanupResult> {
    const details: string[] = [];
    let freedBytes = 0;
    let filesRemoved = 0;

    try {
      if (!existsSync(STORAGE_CONFIG.PATHS.LOGS)) {
        return { freedBytes: 0, freedFormatted: '0 B', filesRemoved: 0, details: ['No logs directory'] };
      }

      const entries = await readdir(STORAGE_CONFIG.PATHS.LOGS);
      for (const entry of entries) {
        const fullPath = join(STORAGE_CONFIG.PATHS.LOGS, entry);
        try {
          const s = await stat(fullPath);
          if (!s.isFile()) continue;

          const isOld = Date.now() - s.mtimeMs > STORAGE_CONFIG.RETENTION.LOG_DAYS * 24 * 60 * 60 * 1000;
          if (!isOld) continue;

          await unlink(fullPath);
          freedBytes += s.size;
          filesRemoved += 1;
          details.push(`Removed old log: ${entry}`);
        } catch { /* skip */ }
      }
    } catch (err: any) {
      logger.error('Log cleanup failed', { error: err.message });
    }

    return {
      freedBytes,
      freedFormatted: formatBytes(freedBytes),
      filesRemoved,
      details,
    };
  }

  static async cleanupOldVideos(uploadedProjectIds: string[]): Promise<CleanupResult> {
    const details: string[] = [];
    let freedBytes = 0;
    let filesRemoved = 0;

    try {
      if (!existsSync(STORAGE_CONFIG.PATHS.VIDEOS)) {
        return { freedBytes: 0, freedFormatted: '0 B', filesRemoved: 0, details: ['No videos directory'] };
      }

      const entries = await readdir(STORAGE_CONFIG.PATHS.VIDEOS);
      for (const entry of entries) {
        const fullPath = join(STORAGE_CONFIG.PATHS.VIDEOS, entry);
        try {
          const s = await stat(fullPath);
          if (!s.isFile()) continue;

          const belongsToUploaded = uploadedProjectIds.some(id => entry.startsWith(id));
          if (!belongsToUploaded) continue;

          const isOld = Date.now() - s.mtimeMs > STORAGE_CONFIG.RETENTION.VIDEO_AFTER_UPLOAD_MS;
          if (!isOld) continue;

          await unlink(fullPath);
          freedBytes += s.size;
          filesRemoved += 1;
          details.push(`Removed old video: ${entry}`);
        } catch { /* skip */ }
      }
    } catch (err: any) {
      logger.error('Video cleanup failed', { error: err.message });
    }

    return {
      freedBytes,
      freedFormatted: formatBytes(freedBytes),
      filesRemoved,
      details,
    };
  }

  static async emergencyCleanup(minBytesToFree: number): Promise<CleanupResult> {
    logger.warn(`Emergency cleanup triggered. Need to free ${formatBytes(minBytesToFree)}`);
    const allDetails: string[] = [];
    let totalFreed = 0;
    let totalFiles = 0;

    // 1. Nuke all temp renders
    const tempResult = await StorageManager.cleanupTempRenders();
    totalFreed += tempResult.freedBytes;
    totalFiles += tempResult.filesRemoved;
    allDetails.push(...tempResult.details);

    if (totalFreed >= minBytesToFree) {
      return { freedBytes: totalFreed, freedFormatted: formatBytes(totalFreed), filesRemoved: totalFiles, details: allDetails };
    }

    // 2. Delete old voiceovers
    const voResult = await StorageManager.cleanupVoiceovers();
    totalFreed += voResult.freedBytes;
    totalFiles += voResult.filesRemoved;
    allDetails.push(...voResult.details);

    if (totalFreed >= minBytesToFree) {
      return { freedBytes: totalFreed, freedFormatted: formatBytes(totalFreed), filesRemoved: totalFiles, details: allDetails };
    }

    // 3. Delete all voiceovers regardless of age (they're stored in DB)
    const voAllResult = await StorageManager.cleanupAllVoiceovers();
    totalFreed += voAllResult.freedBytes;
    totalFiles += voAllResult.filesRemoved;
    allDetails.push(...voAllResult.details);

    if (totalFreed >= minBytesToFree) {
      return { freedBytes: totalFreed, freedFormatted: formatBytes(totalFreed), filesRemoved: totalFiles, details: allDetails };
    }

    // 4. Delete old logs
    const logResult = await StorageManager.cleanupLogs();
    totalFreed += logResult.freedBytes;
    totalFiles += logResult.filesRemoved;
    allDetails.push(...logResult.details);

    return {
      freedBytes: totalFreed,
      freedFormatted: formatBytes(totalFreed),
      filesRemoved: totalFiles,
      details: allDetails,
    };
  }

  static async cleanupAllVoiceovers(): Promise<CleanupResult> {
    return StorageManager.cleanupAgedFiles(
      STORAGE_CONFIG.PATHS.VOICEOVERS,
      0,
      ['.mp3', '.wav', '.ogg', '.flac'],
      'voiceover',
    );
  }

  private static async cleanupAgedFiles(
    dirPath: string,
    ageMs: number,
    extensions: string[],
    label: string,
  ): Promise<CleanupResult> {
    const details: string[] = [];
    let freedBytes = 0;
    let filesRemoved = 0;

    try {
      if (!existsSync(dirPath)) {
        return { freedBytes: 0, freedFormatted: '0 B', filesRemoved: 0, details: [`No ${label} directory`] };
      }

      const entries = await readdir(dirPath);
      for (const entry of entries) {
        const fullPath = join(dirPath, entry);
        try {
          const s = await stat(fullPath);
          if (!s.isFile()) continue;
          if (extensions.length > 0 && !extensions.includes(extname(entry).toLowerCase())) continue;
          if (ageMs > 0 && !(await isOlderThan(fullPath, ageMs))) continue;

          await unlink(fullPath);
          freedBytes += s.size;
          filesRemoved += 1;
          details.push(`Removed ${label}: ${entry}`);
        } catch { /* skip */ }
      }
    } catch (err: any) {
      logger.error(`${label} cleanup failed`, { error: err.message });
    }

    return {
      freedBytes,
      freedFormatted: formatBytes(freedBytes),
      filesRemoved,
      details,
    };
  }

  static async ensureDirectories(): Promise<void> {
    const dirs = Object.values(STORAGE_CONFIG.PATHS);
    await Promise.all(dirs.map(d => mkdir(d, { recursive: true }).catch(() => {})));
  }

  static async getTempSize(): Promise<number> {
    const info = await getDirSize(STORAGE_CONFIG.PATHS.TEMP);
    return info.size;
  }

  static async isTempOverLimit(): Promise<boolean> {
    const size = await StorageManager.getTempSize();
    return size > STORAGE_CONFIG.THRESHOLDS.MAX_TEMP_BYTES;
  }

  static async safeDelete(filePath: string): Promise<boolean> {
    try {
      if (existsSync(filePath)) {
        await unlink(filePath);
        return true;
      }
      return false;
    } catch (err: any) {
      logger.warn(`safeDelete failed for ${filePath}`, { error: err.message });
      return false;
    }
  }

  static async cleanupAfterUpload(projectId: string, filePaths: string[] = [], tempDirs: string[] = []): Promise<{ deleted: number; failed: number }> {
    logger.info(`Cleanup after upload for project ${projectId}`);
    let deleted = 0;
    let failed = 0;

    for (const fp of filePaths) {
      try {
        const fullPath = join(process.cwd(), fp);
        if (existsSync(fullPath)) {
          await unlink(fullPath);
          deleted++;
        }
      } catch {
        failed++;
      }
    }

    for (const dir of tempDirs) {
      try {
        const fullPath = join(process.cwd(), dir);
        if (existsSync(fullPath)) {
          await rm(fullPath, { recursive: true, force: true });
          deleted++;
        }
      } catch {
        failed++;
      }
    }

    logger.info(`Cleanup complete for ${projectId}: ${deleted} removed, ${failed} failures`);
    return { deleted, failed };
  }

  static async scanFiles(type: 'temp' | 'videos' | 'voiceovers' | 'thumbnails' | 'logs'): Promise<{ name: string; path: string; size: number; modified: Date }[]> {
    const dirMap: Record<string, string> = {
      temp: STORAGE_CONFIG.PATHS.TEMP,
      videos: STORAGE_CONFIG.PATHS.VIDEOS,
      voiceovers: STORAGE_CONFIG.PATHS.VOICEOVERS,
      thumbnails: STORAGE_CONFIG.PATHS.THUMBNAILS,
      logs: STORAGE_CONFIG.PATHS.LOGS,
    };
    const dir = dirMap[type];
    if (!dir || !existsSync(dir)) return [];

    const entries = await readdir(dir, { withFileTypes: true });
    const results: { name: string; path: string; size: number; modified: Date }[] = [];

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      try {
        if (entry.isFile()) {
          const s = await stat(fullPath);
          results.push({ name: entry.name, path: fullPath, size: s.size, modified: s.mtime });
        } else if (entry.isDirectory() && type === 'temp') {
          const subEntries = await readdir(fullPath);
          for (const sub of subEntries) {
            const subPath = join(fullPath, sub);
            try {
              const ss = await stat(subPath);
              if (ss.isFile()) {
                results.push({ name: `${entry.name}/${sub}`, path: subPath, size: ss.size, modified: ss.mtime });
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* skip */ }
    }

    return results.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  }
}
