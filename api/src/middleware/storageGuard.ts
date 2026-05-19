import { Request, Response, NextFunction } from 'express';
import { StorageManager, STORAGE_CONFIG } from '../services/storage.service';
import { logger } from '../utils/logger';

let lastCheck = 0;
let cachedStatus: 'ok' | 'warning' | 'critical' = 'ok';
let cachedFreeBytes = 0;
const CHECK_INTERVAL = 30_000;

async function checkDisk(): Promise<{ status: 'ok' | 'warning' | 'critical'; freeBytes: number }> {
  const now = Date.now();
  if (now - lastCheck < CHECK_INTERVAL && cachedFreeBytes > 0) {
    return { status: cachedStatus, freeBytes: cachedFreeBytes };
  }

  const usage = await StorageManager.getUsage();
  cachedStatus = usage.status;
  cachedFreeBytes = usage.freeBytes;
  lastCheck = now;
  return { status: usage.status, freeBytes: usage.freeBytes };
}

export async function storageGuard(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, freeBytes } = await checkDisk();

    if (status === 'critical') {
      logger.warn(`Disk critical: ${(freeBytes / 1024 / 1024).toFixed(1)} MB free, rejecting request`);
      return res.status(507).json({
        success: false,
        message: 'Insufficient storage space. Please free up disk space or wait for cleanup.',
        freeSpace: (freeBytes / 1024 / 1024).toFixed(1) + ' MB',
      });
    }

    if (status === 'warning') {
      res.setHeader('X-Storage-Warning', `Low disk space: ${(freeBytes / 1024 / 1024).toFixed(1)} MB free`);
    }

    next();
  } catch {
    next();
  }
}

export async function storageGuardForRender(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, freeBytes } = await checkDisk();

    if (status === 'warning' || status === 'critical') {
      const isTempOverLimit = await StorageManager.isTempOverLimit();
      if (isTempOverLimit || status === 'critical') {
        logger.warn(`Blocking render: disk ${status}, ${(freeBytes / 1024 / 1024).toFixed(1)} MB free`);
        await StorageManager.cleanupTempRenders();
        const recheck = await checkDisk();
        if (recheck.status === 'critical') {
          return res.status(507).json({
            success: false,
            message: 'Cannot render: insufficient disk space. Cleanup in progress.',
            freeSpace: (recheck.freeBytes / 1024 / 1024).toFixed(1) + ' MB',
          });
        }
      }
    }

    next();
  } catch {
    next();
  }
}
