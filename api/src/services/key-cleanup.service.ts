import { redisConnection } from '../config/redis';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { IDEMPOTENCY_PREFIX } from '../pipeline/idempotency';

const STATE_PREFIX = 'pipeline:state:';
const LOCK_PREFIX = 'pipeline:lock:';
const STEP_PREFIX = 'pipeline:';

export class KeyCleanupService {
  async cleanStaleKeys(dryRun: boolean = true): Promise<{ deleted: number; errors: string[] }> {
    let deleted = 0;
    const errors: string[] = [];

    try {
      const stream = redisConnection.scanStream({
        match: `${STATE_PREFIX}*`,
        count: 100,
      });

      for await (const keys of stream) {
        for (const key of keys) {
          const projectId = key.replace(STATE_PREFIX, '');
          const project = await prisma.videoProject.findUnique({
            where: { id: projectId },
            select: { status: true },
          }).catch(() => null);

          if (!project) {
            if (!dryRun) {
              await redisConnection.del(key);
            }
            deleted++;
          }
        }
      }
    } catch (err: any) {
      errors.push(`State key scan failed: ${err.message}`);
    }

    try {
      const stream2 = redisConnection.scanStream({
        match: `${LOCK_PREFIX}*`,
        count: 100,
      });

      for await (const keys of stream2) {
        for (const key of keys) {
          if (!dryRun) {
            const val = await redisConnection.get(key);
            if (val && (Date.now() - parseInt(val) > 300_000)) {
              await redisConnection.del(key);
              deleted++;
            }
          } else {
            deleted++;
          }
        }
      }
    } catch (err: any) {
      errors.push(`Lock key scan failed: ${err.message}`);
    }

    try {
      const stream3 = redisConnection.scanStream({
        match: `${STEP_PREFIX}*:step:*`,
        count: 100,
      });

      for await (const keys of stream3) {
        for (const key of keys) {
          if (!dryRun) {
            await redisConnection.del(key);
          }
          deleted++;
        }
      }
    } catch (err: any) {
      errors.push(`Step key scan failed: ${err.message}`);
    }

    if (!dryRun) {
      logger.info(`KeyCleanup: removed ${deleted} stale keys (${errors.length} errors)`);
    } else {
      logger.info(`KeyCleanup: dry-run found ${deleted} keys to delete (${errors.length} errors)`);
    }

    return { deleted, errors };
  }
}
