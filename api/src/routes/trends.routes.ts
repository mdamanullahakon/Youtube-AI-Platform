import { Router } from 'express';
import { analyzeTrends, getTrendHistory } from '../controllers/trend.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/analyze', authenticate, analyzeTrends);
router.get('/history', authenticate, getTrendHistory);

export default router;
