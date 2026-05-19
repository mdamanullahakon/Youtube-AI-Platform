import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getSystemStatus,
  startAutomation,
  stopAutomation,
  getAutomationStatus,
  getErrors,
  fixError,
  fixAllErrors,
  getViralOpportunities,
  getWinningPatterns,
  getChannelMetrics,
  generateVideoNow,
  regenerateScript,
} from '../controllers/ai-control.controller';

const router = Router();

router.get('/status', authenticate, getSystemStatus);
router.get('/automation', authenticate, getAutomationStatus);
router.post('/automation/start', authenticate, startAutomation);
router.post('/automation/stop', authenticate, stopAutomation);

router.get('/errors', authenticate, getErrors);
router.post('/errors/fix/:errorId', authenticate, fixError);
router.post('/errors/fix-all', authenticate, fixAllErrors);

router.get('/viral-opportunities', authenticate, getViralOpportunities);
router.get('/winning-patterns', authenticate, getWinningPatterns);
router.get('/channel-metrics', authenticate, getChannelMetrics);

router.post('/generate-video', authenticate, generateVideoNow);
router.post('/regenerate-script/:projectId', authenticate, regenerateScript);

export default router;
