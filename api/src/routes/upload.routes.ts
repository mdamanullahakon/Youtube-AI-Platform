import { Router } from 'express';
import {
  uploadToYouTubeHandler,
  getUploadHistory,
  getFallbackStatusHandler,
  listFallbackQueueHandler,
  exportVideoHandler,
  retryFallbackHandler,
  retryAllFallbackHandler,
  fallbackHealthHandler,
} from '../controllers/upload.controller';
import { authenticate } from '../middleware/auth';
import { validateParams } from '../middleware/validate';
import { projectIdParams } from '../validators';

const router = Router();

router.post('/youtube/:projectId', authenticate, validateParams(projectIdParams), uploadToYouTubeHandler);
router.get('/history', authenticate, getUploadHistory);
router.get('/fallback/status', authenticate, getFallbackStatusHandler);
router.get('/fallback/queue', authenticate, listFallbackQueueHandler);
router.post('/fallback/export/:projectId', authenticate, exportVideoHandler);
router.post('/fallback/retry/:projectId', authenticate, retryFallbackHandler);
router.post('/fallback/retry-all', authenticate, retryAllFallbackHandler);
router.get('/fallback/health', authenticate, fallbackHealthHandler);

export default router;
