import { Router } from 'express';
import { saveApiKeys, getApiKeys } from '../controllers/keys.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/save', authenticate, saveApiKeys);
router.get('/', authenticate, getApiKeys);

export default router;
