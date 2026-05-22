import { prisma } from '../config/db';
import { logger } from '../utils/logger';

/**
 * Service responsible for validating and sanitising analytics data before it is
 * consumed by any downstream intelligence component.
 */
export class AnalyticsValidationService {
  /**
   * Clamp numerical metrics to their valid ranges and drop corrupted rows.
   * @param analyticsRecord The raw analytics record fetched from the DB.
   * @returns The cleaned record or null if the record should be discarded.
   */
  async validateRecord(analyticsRecord: any): Promise<any | null> {
    if (!analyticsRecord) return null;

    // Ensure required numeric fields exist
    const requiredFields = ['ctr', 'retention', 'watchTime'];
    for (const f of requiredFields) {
      if (analyticsRecord[f] === null || analyticsRecord[f] === undefined) {
        logger.warn('AnalyticsValidation: missing field', { id: analyticsRecord.id, field: f });
        return null; // drop incomplete rows
      }
    }

    // Clamp CTR and retention to 0‑100% range
    analyticsRecord.ctr = Math.min(100, Math.max(0, Number(analyticsRecord.ctr)));
    analyticsRecord.retention = Math.min(100, Math.max(0, Number(analyticsRecord.retention)));

    // Watch time should be non‑negative
    analyticsRecord.watchTime = Math.max(0, Number(analyticsRecord.watchTime));

    return analyticsRecord;
  }

  /**
   * Bulk‑validate a list of analytics rows and return only the clean ones.
   */
  async validateBatch(records: any[]): Promise<any[]> {
    const clean: any[] = [];
    for (const rec of records) {
      const cleaned = await this.validateRecord(rec);
      if (cleaned) clean.push(cleaned);
    }
    return clean;
  }
}
