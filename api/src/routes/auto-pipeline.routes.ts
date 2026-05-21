import { Router } from 'express';
import { runAutoPipelineHandler } from '../controllers/auto-pipeline.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/run', authenticate, runAutoPipelineHandler);

export default router;
