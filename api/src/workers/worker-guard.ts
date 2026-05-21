import { Worker } from 'bullmq';
import { logger } from '../utils/logger';

interface ErrorRecord {
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

const workerErrorCounters = new Map<string, Map<string, ErrorRecord>>();

const MAX_CONSECUTIVE_SAME_ERROR = 5;
const GUARD_WINDOW_MS = 60_000;

export function guardWorker(
  worker: Worker,
  workerName: string,
  errorEvent: (err: Error) => void = () => {}
) {
  if (!workerErrorCounters.has(workerName)) {
    workerErrorCounters.set(workerName, new Map());
  }

  const errors = workerErrorCounters.get(workerName)!;

  worker.on('error', (err: Error) => {
    const errMsg = err.message || 'Unknown error';
    const now = Date.now();

    let record = errors.get(errMsg);
    if (!record) {
      record = { message: errMsg, count: 0, firstSeen: now, lastSeen: now };
      errors.set(errMsg, record);
    }

    if (now - record.lastSeen > GUARD_WINDOW_MS) {
      errors.clear();
      record = { message: errMsg, count: 1, firstSeen: now, lastSeen: now };
      errors.set(errMsg, record);
    } else {
      record.count++;
      record.lastSeen = now;
    }

    if (record.count >= MAX_CONSECUTIVE_SAME_ERROR) {
      logger.error(`[GUARD] ${workerName}: error "${errMsg}" repeated ${record.count}x in window — FORCE STOPPING worker`);
      worker.close(true).catch(() => {});
      return;
    }

    logger.warn(`[GUARD] ${workerName}: error "${errMsg}" (${record.count}/${MAX_CONSECUTIVE_SAME_ERROR})`);

    errorEvent(err);
  });
}
