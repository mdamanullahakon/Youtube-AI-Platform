import { Request, Response } from 'express';
import { QueueMonitor } from '../queues/monitor';
import { logger } from '../utils/logger';

export async function getQueueStatuses(req: Request, res: Response) {
  try {
    const statuses = await QueueMonitor.getQueueStatuses();
    res.json({ success: true, queues: statuses });
  } catch (error: any) {
    logger.error('Failed to get queue statuses', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get queue statuses' });
  }
}

export async function getQueueJobs(req: Request, res: Response) {
  try {
    const queueName = String(req.params.queueName);
    const status = String(req.query.status || 'failed');
    const limit = parseInt(String(req.query.limit || '20'), 10) || 20;

    let jobs;
    switch (status) {
      case 'active':
        jobs = await QueueMonitor.getActiveJobs(queueName, limit);
        break;
      case 'waiting':
        jobs = await QueueMonitor.getWaitingJobs(queueName, limit);
        break;
      case 'failed':
      default:
        jobs = await QueueMonitor.getFailedJobs(queueName, limit);
        break;
    }

    res.json({ success: true, queue: queueName, status, jobs });
  } catch (error: any) {
    logger.error('Failed to get queue jobs', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get queue jobs' });
  }
}

export async function getJobDetails(req: Request, res: Response) {
  try {
    const queueName = String(req.params.queueName);
    const jobId = String(req.params.jobId);
    const job = await QueueMonitor.getJobDetails(queueName, jobId);

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    res.json({ success: true, job });
  } catch (error: any) {
    logger.error('Failed to get job details', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get job details' });
  }
}

export async function retryJob(req: Request, res: Response) {
  try {
    const queueName = String(req.params.queueName);
    const jobId = String(req.params.jobId);
    const success = await QueueMonitor.retryJob(queueName, jobId);

    if (!success) {
      return res.status(404).json({ success: false, message: 'Job not found or retry failed' });
    }

    res.json({ success: true, message: `Job ${jobId} requeued for retry` });
  } catch (error: any) {
    logger.error('Failed to retry job', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to retry job' });
  }
}

export async function retryAllFailedJobs(req: Request, res: Response) {
  try {
    const queueName = String(req.params.queueName);
    const count = await QueueMonitor.retryAllFailed(queueName);

    res.json({ success: true, message: `${count} failed jobs requeued for retry` });
  } catch (error: any) {
    logger.error('Failed to retry all jobs', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to retry all jobs' });
  }
}

export async function getDLQJobs(req: Request, res: Response) {
  try {
    const limit = parseInt(String(req.query.limit || '20'), 10) || 20;
    const jobs = await QueueMonitor.getDLQJobs(limit);
    res.json({ success: true, deadLetterJobs: jobs });
  } catch (error: any) {
    logger.error('Failed to get DLQ jobs', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get DLQ jobs' });
  }
}

export async function recoverDLQJob(req: Request, res: Response) {
  try {
    const jobId = String(req.params.jobId);
    const success = await QueueMonitor.recoverDLQJob(jobId);

    if (!success) {
      return res.status(404).json({ success: false, message: 'DLQ job not found or recovery failed' });
    }

    res.json({ success: true, message: `DLQ job ${jobId} recovered to original queue` });
  } catch (error: any) {
    logger.error('Failed to recover DLQ job', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to recover DLQ job' });
  }
}

export async function getPipelineProgress(req: Request, res: Response) {
  try {
    const projectId = String(req.params.projectId);
    const progress = await QueueMonitor.getPipelineProgress(projectId);

    if (!progress) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    res.json({ success: true, progress });
  } catch (error: any) {
    logger.error('Failed to get pipeline progress', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get pipeline progress' });
  }
}
