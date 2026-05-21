import { Router } from 'express';
import { testUploadHandler } from '../controllers/test-upload.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/', authenticate, testUploadHandler);

export default router;
