import { Router } from 'express';
import {
  generateHorrorStoryHandler,
  generateHorrorStoryAndEnqueueHandler,
  generateHorrorSEOHandler,
  generateHorrorTitleVariantsHandler,
  generateHorrorHookVariantsHandler,
  getHorrorNicheStrategyHandler,
  listHorrorSubNichesHandler,
  previewHorrorSceneImagesHandler,
} from '../controllers/horror.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.post('/story', authenticate, generateHorrorStoryHandler);
router.post('/pipeline', authenticate, generateHorrorStoryAndEnqueueHandler);
router.post('/seo', authenticate, generateHorrorSEOHandler);
router.post('/titles', authenticate, generateHorrorTitleVariantsHandler);
router.post('/hooks', authenticate, generateHorrorHookVariantsHandler);
router.get('/niches', listHorrorSubNichesHandler);
router.get('/strategy/:niche', authenticate, getHorrorNicheStrategyHandler);
router.post('/scene-previews', authenticate, previewHorrorSceneImagesHandler);

export default router;
