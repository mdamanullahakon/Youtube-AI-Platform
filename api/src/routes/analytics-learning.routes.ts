import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate, validateQuery, validateParams } from '../middleware/validate';
import {
  analyzeProjectLearning,
  getLearningCorrelations,
  getThumbnailAnalysis,
  getProjectThumbnailAnalysis,
  getRetentionAnalysis,
  getProjectLearning,
  getGlobalReport,
  getCrossProjectStats,
  getPerformanceRecords,
  getScriptFeedback,
  predictThumbnailCTR,
  saveThumbnailPerformance,
} from '../controllers/analytics-learning.controller';
import {
  analyzeProjectLearningSchema,
  predictThumbnailCTRSchema,
  saveThumbnailPerformanceSchema,
  getScriptFeedbackQuery,
  projectIdParams,
} from '../validators';

const router = Router();

router.post('/analyze/:projectId', authenticate, validateParams(projectIdParams), validate(analyzeProjectLearningSchema), analyzeProjectLearning);
router.get('/correlations', authenticate, getLearningCorrelations);
router.get('/thumbnails/analysis', authenticate, getThumbnailAnalysis);
router.get('/thumbnails/:projectId', authenticate, validateParams(projectIdParams), getProjectThumbnailAnalysis);
router.get('/retention/:projectId', authenticate, validateParams(projectIdParams), getRetentionAnalysis);
router.get('/learning/:projectId', authenticate, validateParams(projectIdParams), getProjectLearning);
router.get('/global-report', authenticate, getGlobalReport);
router.get('/cross-project', authenticate, getCrossProjectStats);
router.get('/performance-records', authenticate, getPerformanceRecords);
router.get('/script-feedback', authenticate, validateQuery(getScriptFeedbackQuery), getScriptFeedback);
router.post('/predict-thumbnail-ctr', authenticate, validate(predictThumbnailCTRSchema), predictThumbnailCTR);
router.post('/save-thumbnail-performance', authenticate, validate(saveThumbnailPerformanceSchema), saveThumbnailPerformance);

export default router;
