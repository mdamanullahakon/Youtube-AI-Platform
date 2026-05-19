import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate, validateQuery } from '../middleware/validate';

import {
  scanViralOpportunities,
  getViralOpportunities,
  extractWinningPatterns,
  getWinningPatterns,
  scoreRetention,
  optimizeScriptRetention,
  generateThumbnailVariants,
  generateTitleVariants,
  getMonetizationReport,
  runPostUploadAnalysis,
  createUploadSchedule,
  getStrategy,
  listStrategies,
  cleanupProject,
  getBusinessDashboard,
  predictThumbnailCTRHandler,
  predictTitleCTRHandler,
  simulateRetentionHandler,
  getRetentionCurveHandler,
  predictEarningsHandler,
  createABTestHandler,
  recordABTestResultHandler,
  getABTestsByProjectHandler,
  getBestABTestVariantHandler,
  getBestUploadTimeHandler,
  trackUploadTimePerformanceHandler,
  humanizeScriptHandler,
  enhanceScriptEmotionHandler,
  enhanceScriptPacingHandler,
  enhanceScriptFullHandler,
} from '../controllers/business.controller';

import {
  generateThumbnailVariantsSchema,
  generateTitleVariantsSchema,
  analyzeTranscriptSchema,
  postUploadAnalysisSchema,
  retentionScoreSchema,
  createScheduleSchema,
  generateStrategySchema,
  viralOpportunitiesQuery,
  winningPatternsQuery,
  monetizationReportQuery,
  businessPredictThumbnailCTRSchema,
  predictTitleCTRSchema,
  simulateRetentionSchema,
  predictEarningsSchema,
  createABTestSchema,
  recordABTestResultSchema,
  trackUploadTimeSchema,
  humanizeScriptSchema,
  enhanceScriptSchema,
} from '../validators';

const router = Router();

router.get('/dashboard', authenticate, getBusinessDashboard);

router.post('/viral/scan', authenticate, scanViralOpportunities);
router.get('/viral/opportunities', authenticate, getViralOpportunities);

router.post('/patterns/extract', authenticate, validate(analyzeTranscriptSchema), extractWinningPatterns);
router.get('/patterns', authenticate, getWinningPatterns);

router.post('/retention/score', authenticate, validate(retentionScoreSchema), scoreRetention);
router.post('/retention/optimize', authenticate, validate(retentionScoreSchema), optimizeScriptRetention);

router.post('/thumbnails/generate', authenticate, validate(generateThumbnailVariantsSchema), generateThumbnailVariants);
router.post('/titles/generate', authenticate, validate(generateTitleVariantsSchema), generateTitleVariants);

router.get('/monetization', authenticate, getMonetizationReport);

router.post('/analyze', authenticate, validate(postUploadAnalysisSchema), runPostUploadAnalysis);

router.post('/schedule', authenticate, validate(createScheduleSchema), createUploadSchedule);

router.get('/strategies', authenticate, listStrategies);
router.get('/strategies/:niche', authenticate, getStrategy);

router.post('/cleanup', authenticate, validate(postUploadAnalysisSchema), cleanupProject);

router.post('/ctr/predict-thumbnail', authenticate, validate(businessPredictThumbnailCTRSchema), predictThumbnailCTRHandler);
router.post('/ctr/predict-title', authenticate, validate(predictTitleCTRSchema), predictTitleCTRHandler);

router.post('/retention/simulate', authenticate, validate(simulateRetentionSchema), simulateRetentionHandler);
router.get('/retention/curve/:projectId', authenticate, getRetentionCurveHandler);

router.post('/monetization/predict', authenticate, validate(predictEarningsSchema), predictEarningsHandler);

router.post('/ab-testing/create', authenticate, validate(createABTestSchema), createABTestHandler);
router.post('/ab-testing/record', authenticate, validate(recordABTestResultSchema), recordABTestResultHandler);
router.get('/ab-testing/:projectId', authenticate, getABTestsByProjectHandler);
router.get('/ab-testing/best-variant/:testType', authenticate, getBestABTestVariantHandler);

router.get('/upload-time/best/:channelId', authenticate, getBestUploadTimeHandler);
router.post('/upload-time/track', authenticate, validate(trackUploadTimeSchema), trackUploadTimePerformanceHandler);

router.post('/quality/humanize', authenticate, validate(humanizeScriptSchema), humanizeScriptHandler);
router.post('/quality/emotional-depth', authenticate, validate(enhanceScriptSchema), enhanceScriptEmotionHandler);
router.post('/quality/pacing', authenticate, validate(enhanceScriptSchema), enhanceScriptPacingHandler);
router.post('/quality/enhance', authenticate, validate(enhanceScriptSchema), enhanceScriptFullHandler);

export default router;
