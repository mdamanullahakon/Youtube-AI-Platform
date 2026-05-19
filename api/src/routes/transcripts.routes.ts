import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { analyzeTranscripts } from '../controllers/transcript.controller';
import { analyzeTranscriptsSchema } from '../validators';

const router = Router();

router.post('/analyze', authenticate, validate(analyzeTranscriptsSchema), analyzeTranscripts);

export default router;
