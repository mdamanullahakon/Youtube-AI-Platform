import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate, validateQuery } from '../middleware/validate';

import {
  initializeGodmode,
  scanAndDetectTrends,
  analyzeTopics,
  getNicheRecommendations,
  generateVideoIdeaHandler,
  generateScriptHandler,
  generateRoadmap,
  generateLaunchBlueprint,
  getFullExecutionPlan,
  generateTitleVariantsHandler,
  generateHookVariantsHandler,
  getPredictions,
} from '../controllers/godmode.controller';

import {
  initializeGodmodeSchema,
  scanTrendsSchema,
  analyzeTopicsSchema,
  generateVideoIdeaSchema,
  generateScriptSchema,
  generateRoadmapSchema,
  generateBlueprintSchema,
  getNicheRecommendationsQuery,
  godmodeTitleVariantsSchema,
  generateHookVariantsSchema,
} from '../validators';

const router = Router();

router.post('/initialize', authenticate, validate(initializeGodmodeSchema), initializeGodmode);

router.post('/scan', authenticate, scanAndDetectTrends);

router.post('/analyze', authenticate, validate(analyzeTopicsSchema), analyzeTopics);

router.get('/niche-recommendations', authenticate, getNicheRecommendations);

router.post('/video-idea', authenticate, validate(generateVideoIdeaSchema), generateVideoIdeaHandler);

router.post('/generate-script', authenticate, validate(generateScriptSchema), generateScriptHandler);

router.post('/generate-roadmap', authenticate, validate(generateRoadmapSchema), generateRoadmap);

router.post('/launch-blueprint', authenticate, validate(generateBlueprintSchema), generateLaunchBlueprint);

router.get('/execution-plan/:niche', authenticate, getFullExecutionPlan);

router.post('/title-variants', authenticate, validate(godmodeTitleVariantsSchema), generateTitleVariantsHandler);

router.post('/hook-variants', authenticate, validate(generateHookVariantsSchema), generateHookVariantsHandler);

router.get('/predictions', authenticate, getPredictions);

export default router;