import { Router } from 'express';
import { generateScriptHandler } from '../controllers/script.controller';
import { authenticate } from '../middleware/auth';
import { validateParams } from '../middleware/validate';
import { projectIdParams } from '../validators';

const router = Router();

router.post('/generate/:projectId', authenticate, validateParams(projectIdParams), generateScriptHandler);

export default router;
