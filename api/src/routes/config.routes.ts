import { Router } from 'express';
import { getStatus, getMissing, setConfig, deleteConfig, testConfig, assistantQuery } from '../controllers/config.controller';
import { optionalAuth } from '../middleware/auth';

const router = Router();

router.get('/status', optionalAuth, getStatus);
router.get('/missing', optionalAuth, getMissing);
router.post('/set', optionalAuth, setConfig);
router.post('/test', optionalAuth, testConfig);
router.post('/assistant', optionalAuth, assistantQuery);
router.delete('/:key', optionalAuth, deleteConfig);

export default router;
