import { Router } from 'express';
import {
  getBusinessDashboardHandler,
  getChannelRevenueHandler,
  getVideoRevenueHandler,
  getCrossChannelDashboardHandler,
  runDailyOrchestrationHandler,
} from '../controllers/business-dashboard.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.get('/dashboard', authenticate, getBusinessDashboardHandler);
router.get('/cross-channel', authenticate, getCrossChannelDashboardHandler);
router.get('/revenue/channel/:channelId', authenticate, getChannelRevenueHandler);
router.get('/revenue/video/:projectId', authenticate, getVideoRevenueHandler);
router.post('/orchestrate/daily', authenticate, runDailyOrchestrationHandler);

export default router;
