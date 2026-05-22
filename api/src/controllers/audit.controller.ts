import { Request, Response } from 'express';
import { ChannelAuditService } from '../services/channel-audit.service';
import { ChannelOptimizerService } from '../services/channel-optimizer.service';
import { logger } from '../utils/logger';

const auditService = new ChannelAuditService();
const optimizerService = new ChannelOptimizerService();

/**
 * POST /api/audit/channel
 * Runs a full channel audit for the given channel ID.
 */
export async function runChannelAudit(req: Request, res: Response) {
  try {
    const userId = (req as any).userId;
    const { channelId, expectedNiche, competitorChannelIds, channelDescription, channelTags, channelBannerUrl, channelLogoUrl } = req.body;

    if (!channelId) {
      return res.status(400).json({
        success: false,
        message: 'channelId is required',
      });
    }

    logger.info(`[AuditController] Channel audit requested by user ${userId} for channel ${channelId}`);

    const report = await auditService.runAudit({
      channelId,
      expectedNiche: expectedNiche || undefined,
      competitorChannelIds: competitorChannelIds || undefined,
      channelDescription: channelDescription || undefined,
      channelTags: channelTags || undefined,
      channelBannerUrl: channelBannerUrl || undefined,
      channelLogoUrl: channelLogoUrl || undefined,
    });

    // Determine health status from final score
    let healthStatus: '🟢 Optimized' | '🟡 Needs Improvement' | '🔴 Critical Issues';
    if (report.final_score >= 70) healthStatus = '🟢 Optimized';
    else if (report.final_score >= 40) healthStatus = '🟡 Needs Improvement';
    else healthStatus = '🔴 Critical Issues';

    res.status(200).json({
      success: true,
      channelId,
      healthStatus,
      report,
    });
  } catch (err: any) {
    logger.error('[AuditController] Channel audit failed', { error: err.message });
    res.status(500).json({
      success: false,
      message: 'Channel audit failed',
      error: err.message,
    });
  }
}

/**
 * POST /api/audit/optimize
 * Takes a channel audit report and executes full channel optimization.
 * Auto-generates: description, tags, name, banner, logo, content strategy, SEO, monetization.
 */
export async function optimizeChannel(req: Request, res: Response) {
  try {
    const userId = (req as any).userId;
    const { auditReport, channelName, channelDescription, channelTags, channelBanner, channelLogo, targetNiche, targetAudience, competitorInsights } = req.body;

    if (!auditReport || !channelName || !targetNiche) {
      return res.status(400).json({
        success: false,
        message: 'auditReport, channelName, and targetNiche are required',
      });
    }

    logger.info(`[AuditController] Channel optimization requested by user ${userId} for ${channelName}`);

    const result = await optimizerService.runOptimization({
      auditReport,
      channelName,
      channelDescription: channelDescription || '',
      channelTags: channelTags || '',
      channelBanner: channelBanner || '',
      channelLogo: channelLogo || '',
      targetNiche,
      targetAudience: targetAudience || '',
      competitorInsights: competitorInsights || undefined,
    });

    // Use the audit report score to determine execution mode (matching the AI prompt's mode)
    const auditScore = auditReport.final_score;
    let mode: 'FINE_TUNING' | 'AGGRESSIVE_OPTIMIZATION' | 'PARTIAL_REBRAND' | 'FULL_REBRAND';
    if (auditScore >= 60) mode = 'FINE_TUNING';
    else if (auditScore >= 40) mode = 'AGGRESSIVE_OPTIMIZATION';
    else if (auditScore >= 25) mode = 'PARTIAL_REBRAND';
    else mode = 'FULL_REBRAND';

    res.status(200).json({
      success: true,
      channelName,
      auditScore,
      mode,
      result,
    });
  } catch (err: any) {
    logger.error('[AuditController] Channel optimization failed', { error: err.message });
    res.status(500).json({
      success: false,
      message: 'Channel optimization failed',
      error: err.message,
    });
  }
}

/**
 * GET /api/audit/status
 * Check if audit service is available (AI service check).
 */
export async function getAuditStatus(_req: Request, res: Response) {
  res.json({
    success: true,
    service: 'channel-audit',
    version: '1.0.0',
    status: 'available',
  });
}
