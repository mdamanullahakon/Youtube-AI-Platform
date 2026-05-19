import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate, validateQuery, validateParams } from '../middleware/validate';
import {
  getStorageUsage,
  getStorageFiles,
  queueStorageCleanup,
  runEmergencyCleanup,
  getStorageStatus,
} from '../controllers/storage.controller';
import { getStorageFilesQuery, queueCleanupSchema } from '../validators';

const router = Router();

router.get('/usage', authenticate, getStorageUsage);
router.get('/files', authenticate, validateQuery(getStorageFilesQuery), getStorageFiles);
router.post('/cleanup', authenticate, validate(queueCleanupSchema), queueStorageCleanup);
router.post('/emergency-cleanup', authenticate, runEmergencyCleanup);
router.get('/status', authenticate, getStorageStatus);

export default router;
