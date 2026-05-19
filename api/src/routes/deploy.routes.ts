import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { deployVercel, deployVPS, checkStatus, getDeployLogs } from '../controllers/deploy.controller';

const router = Router();

router.post('/vercel', authenticate, deployVercel);
router.post('/vps', authenticate, deployVPS);
router.get('/status', authenticate, checkStatus);
router.get('/logs', authenticate, getDeployLogs);

export default router;
