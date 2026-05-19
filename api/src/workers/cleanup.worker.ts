import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';
import { unlink, rm, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { StorageManager } from '../services/storage.service';

export interface CleanupJobData {
  projectId: string;
  filePaths: string[];
  tempDirs?: string[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
}

async function getDirSize(dirPath: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += await getDirSize(fullPath);
        } else if (entry.isFile()) {
          const s = await stat(fullPath);
          total += s.size;
        }
      } catch { }
    }
  } catch { }
  return total;
}

let worker: Worker | null = null;

async function isRedisVersionCompatible(): Promise<boolean> {
  try {
    const { redisConnection } = await import('../config/redis');
    if (redisConnection.status !== 'ready') {
      await redisConnection.connect().catch(() => {});
    }
    const info = await redisConnection.info('server').catch(() => '');
    const versionMatch = info.match(/redis_version:(\d+)\.\d+\.\d+/);
    const major = versionMatch ? parseInt(versionMatch[1], 10) : 0;
    return major >= 5;
  } catch {
    return false;
  }
}

async function getWorker(): Promise<Worker | null> {
  if (!worker) {
    const compatible = await isRedisVersionCompatible();
    if (!compatible) {
      logger.warn('Redis version < 5 — cleanup worker not created');
      return null;
    }
    worker = new Worker(
      'cleanup',
      async (job) => {
        logger.info(`Processing cleanup job ${job.id} for project ${job.data.projectId}`);
        await job.updateProgress(0);

        const { projectId, filePaths, tempDirs } = job.data as CleanupJobData;

        logger.info(`Cleanup: starting deletion for project ${projectId} files`);
        const beforeBytes = await getDirSize(join(process.cwd(), 'temp'))
          + await getDirSize(join(process.cwd(), 'uploads')).catch(() => 0);

        let deletedCount = 0;
        let failedCount = 0;

        for (const filePath of filePaths) {
          const fullPath = join(process.cwd(), filePath);
          try {
            if (existsSync(fullPath)) {
              await unlink(fullPath);
              deletedCount++;
              logger.debug(`Cleaned file: ${filePath}`);
            }
          } catch (err: any) {
            failedCount++;
            logger.warn(`Failed to delete ${filePath}`, { error: err.message });
          }
        }

        if (tempDirs) {
          for (const dir of tempDirs) {
            const fullPath = join(process.cwd(), dir);
            try {
              if (existsSync(fullPath)) {
                await rm(fullPath, { recursive: true, force: true });
                deletedCount++;
                logger.debug(`Cleaned directory: ${dir}`);
              }
            } catch (err: any) {
              failedCount++;
              logger.warn(`Failed to delete directory ${dir}`, { error: err.message });
            }
          }
        }

        const tempDir = join(process.cwd(), 'temp');
        if (existsSync(tempDir)) {
          try {
            const items = await readdir(tempDir);
            for (const item of items) {
              if (item.startsWith('render_') || item.includes(projectId)) {
                const fullPath = join(tempDir, item);
                await rm(fullPath, { recursive: true, force: true }).catch(() => {});
                deletedCount++;
              }
            }
          } catch {}
        }

        const uploadsDir = join(process.cwd(), 'uploads', 'voiceovers');
        if (existsSync(uploadsDir)) {
          try {
            const files = await readdir(uploadsDir);
            for (const f of files.filter(f => f.includes(projectId))) {
              await unlink(join(uploadsDir, f)).catch(() => {});
              deletedCount++;
            }
          } catch {}
        }

        const uploadsThumbsDir = join(process.cwd(), 'uploads', 'thumbnails');
        if (existsSync(uploadsThumbsDir)) {
          try {
            const files = await readdir(uploadsThumbsDir);
            for (const f of files.filter(f => f.includes(projectId))) {
              await unlink(join(uploadsThumbsDir, f)).catch(() => {});
              deletedCount++;
            }
          } catch {}
        }

        const afterBytes = await getDirSize(join(process.cwd(), 'temp'))
          + await getDirSize(join(process.cwd(), 'uploads')).catch(() => 0);
        const freed = beforeBytes - afterBytes;

        await job.updateProgress(100);
        logger.info(`Cleanup job ${job.id} complete: ${deletedCount} items removed, ${failedCount} failures, ${formatBytes(Math.max(0, freed))} freed`);
        return { deletedCount, failedCount, freedBytes: Math.max(0, freed) };
      },
      {
        connection: redisConnection,
        concurrency: 1,
        lockDuration: 300_000,
        stalledInterval: 60_000,
      }
    );

    worker.on('completed', (job) => logger.info(`Cleanup job ${job.id} completed`));
    worker.on('failed', (job, err) => logger.warn(`Cleanup job ${job?.id} failed`, { error: err.message }));
    worker.on('error', (err) => {
      if (err.message.includes('SCRIPT') || err.message.includes('evalsha') || err.message.includes('NOSCRIPT')) {
        logger.error('Cleanup worker FATAL Lua script error — worker shutting down', { error: err.message });
        worker?.close();
        return;
      }
      logger.error('Cleanup worker error', { error: err.message });
    });
  }
  return worker;
}

export async function scheduleCleanupJobs() {
  logger.info('Scheduled cleanup jobs initialized (handled by 15-min disk check cron)');
}

export { getWorker as worker };
