import { Router } from 'express';
import {
  getProjectAnalytics,
  getDashboardStats,
  getRecentProjects,
} from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth';
import { validateParams } from '../middleware/validate';
import { projectIdParams } from '../validators';

const router = Router();

router.get('/dashboard', authenticate, getDashboardStats);
router.get('/projects', authenticate, getRecentProjects);
router.get('/project/:projectId', authenticate, validateParams(projectIdParams), getProjectAnalytics);

export default router;
