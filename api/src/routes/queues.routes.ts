import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validate, validateQuery, validateParams } from '../middleware/validate';
import {
  getQueueStatuses,
  getQueueJobs,
  getJobDetails,
  retryJob,
  retryAllFailedJobs,
  getDLQJobs,
  recoverDLQJob,
  getPipelineProgress,
} from '../controllers/queue.controller';
import {
  queueNameParams,
  queueJobParams,
  jobIdParam,
  projectIdParams,
  getQueueJobsQuery,
} from '../validators';

const router = Router();

router.get('/status', authenticate, getQueueStatuses);
router.get('/:queueName/jobs', authenticate, validateParams(queueNameParams), validateQuery(getQueueJobsQuery), getQueueJobs);
router.get('/:queueName/jobs/:jobId', authenticate, validateParams(queueJobParams), getJobDetails);
router.post('/:queueName/retry/:jobId', authenticate, validateParams(queueJobParams), retryJob);
router.post('/:queueName/retry-all', authenticate, validateParams(queueNameParams), retryAllFailedJobs);
router.get('/dlq/list', authenticate, getDLQJobs);
router.post('/dlq/recover/:jobId', authenticate, validateParams(jobIdParam), recoverDLQJob);
router.get('/pipeline/:projectId', authenticate, validateParams(projectIdParams), getPipelineProgress);

export default router;
