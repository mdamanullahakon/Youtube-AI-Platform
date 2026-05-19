import { Router } from 'express';
import {
  generateVideoPipeline,
  renderVideoHandler,
  getProjectStatus,
  createVideoProject,
  deleteProject,
} from '../controllers/video.controller';
import { authenticate } from '../middleware/auth';
import { validate, validateParams } from '../middleware/validate';
import { createProjectSchema, projectIdParams } from '../validators';

const router = Router();

router.post('/generate/new', authenticate, validate(createProjectSchema), createVideoProject);
router.post('/generate/:projectId', authenticate, validateParams(projectIdParams), generateVideoPipeline);
router.post('/render/:projectId', authenticate, validateParams(projectIdParams), renderVideoHandler);
router.get('/status/:projectId', authenticate, validateParams(projectIdParams), getProjectStatus);
router.delete('/:projectId', authenticate, validateParams(projectIdParams), deleteProject);

export default router;
