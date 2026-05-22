import { Router } from 'express';
import { enqueuePipeline } from '../controllers/pipeline.controller';

const router = Router();

// POST /api/pipeline/run
router.post('/run', enqueuePipeline);

export default router;