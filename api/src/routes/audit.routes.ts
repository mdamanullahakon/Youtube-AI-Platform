import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { runChannelAudit, optimizeChannel, getAuditStatus } from '../controllers/audit.controller';

const router = Router();

/**
 * POST /api/audit/channel — Run a full channel audit
 * Body: { channelId: string, expectedNiche?: string, competitorChannelIds?: string[], channelDescription?: string, channelTags?: string, channelBannerUrl?: string, channelLogoUrl?: string }
 */
router.post('/channel', authenticate, runChannelAudit);

/**
 * POST /api/audit/optimize — Execute full channel optimization
 * Body: { auditReport: ChannelAuditReport, channelName: string, channelDescription?: string, channelTags?: string, channelBanner?: string, channelLogo?: string, targetNiche: string, targetAudience?: string, competitorInsights?: string }
 */
router.post('/optimize', authenticate, optimizeChannel);

/**
 * GET /api/audit/status — Check audit service availability
 */
router.get('/status', authenticate, getAuditStatus);

export default router;
