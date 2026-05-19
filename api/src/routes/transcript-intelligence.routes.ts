import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate, validateQuery, validateParams } from '../middleware/validate';
import {
  analyzeTranscriptIntelligence,
  analyzeTranscriptText,
  getInsights,
  applyInsight,
  getScriptImprovements,
  getProjectTranscriptIntelligence,
  getPerformanceCorrelation,
} from '../controllers/transcript-intelligence.controller';
import {
  analyzeTISchema,
  analyzeTextSchema,
  getInsightsQuery,
  getScriptImprovementsQuery,
  projectIdParams,
  idParam,
} from '../validators';

const router = Router();

router.post('/analyze', authenticate, validate(analyzeTISchema), analyzeTranscriptIntelligence);
router.post('/analyze-text', authenticate, validate(analyzeTextSchema), analyzeTranscriptText);
router.get('/insights', authenticate, validateQuery(getInsightsQuery), getInsights);
router.get('/insights/:id/apply', authenticate, validateParams(idParam), applyInsight);
router.get('/script-improvements', authenticate, validateQuery(getScriptImprovementsQuery), getScriptImprovements);
router.get('/project/:projectId', authenticate, validateParams(projectIdParams), getProjectTranscriptIntelligence);
router.get('/performance-correlation', authenticate, getPerformanceCorrelation);

export default router;
