import { Router, Request, Response } from 'express';
import { dlqManager } from '../services/dlq-manager.service';
import { workerHeartbeat } from '../services/worker-heartbeat.service';
import { autoScaling } from '../services/auto-scaling.service';
import { qualityGate } from '../services/quality-gate.service';
import { monetizationEngine } from '../services/monetization-engine.service';
import { logger } from '../utils/logger';
import { redisConnection } from '../config/redis';

const router = Router();

// ─── DLQ Management ──────────────────────────────────────────────────────────

router.get('/dlq/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await dlqManager.getStats();
    res.json({ success: true, stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/dlq/jobs', async (req: Request, res: Response) => {
  try {
    const filter: any = {};
    if (req.query.status) filter.status = req.query.status as string;
    if (req.query.queue) filter.queue = req.query.queue as string;
    const jobs = await dlqManager.getJobs(filter);
    res.json({ success: true, jobs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/dlq/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId as string;
    const job = await dlqManager.getJob(jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, job });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/dlq/jobs/:jobId/requeue', async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId as string;
    const success = await dlqManager.requeueJob(jobId);
    res.json({ success, message: success ? 'Job requeued' : 'Job not found' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/dlq/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const jobId = req.params.jobId as string;
    await dlqManager.purgeJob(jobId);
    res.json({ success: true, message: 'Job purged' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/dlq/clusters', async (_req: Request, res: Response) => {
  try {
    const clusters = await dlqManager.getClusters();
    res.json({ success: true, clusters });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Worker Status ───────────────────────────────────────────────────────────

router.get('/workers', async (_req: Request, res: Response) => {
  try {
    const workers = await workerHeartbeat.getActiveWorkers();
    res.json({ success: true, workers, count: workers.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/workers/stale', async (_req: Request, res: Response) => {
  try {
    const stale = await workerHeartbeat.findStaleWorkers();
    res.json({ success: true, staleWorkerIds: stale, count: stale.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/workers/recover', async (_req: Request, res: Response) => {
  try {
    const recovered = await workerHeartbeat.requeueStalledJobs();
    res.json({ success: true, recoveredJobs: recovered });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Auto-Scaling Status ─────────────────────────────────────────────────────

router.get('/scaling/status', async (_req: Request, res: Response) => {
  try {
    const flags = await redisConnection.mget(
      'scaling:throttle:render',
      'scaling:pause:ai',
    );
    const lastAction = await redisConnection.get('scaling:action:last');
    res.json({
      success: true,
      flags: {
        throttleRender: flags[0] === '1',
        pauseAi: flags[1] === '1',
      },
      lastAction: lastAction ? JSON.parse(lastAction) : null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/scaling/evaluate', async (_req: Request, res: Response) => {
  try {
    const actions = await autoScaling.evaluate();
    res.json({ success: true, actions, count: actions.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Quality Gate ────────────────────────────────────────────────────────────

router.post('/quality-gate/evaluate/:projectId', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId as string;
    const result = await qualityGate.evaluate(projectId);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/quality-gate/autofix/:projectId', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId as string;
    const result = await qualityGate.autoFix(projectId);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Monetization ────────────────────────────────────────────────────────────

router.get('/monetization/predict-rpm/:channelId', async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    const topic = (req.query.topic as string) || 'technology';
    const duration = parseInt(req.query.duration as string) || 300;
    const prediction = await monetizationEngine.predictRpm(channelId, topic, duration);
    res.json({ success: true, prediction });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/monetization/optimize/:projectId', async (req: Request, res: Response) => {
  try {
    const projectId = req.params.projectId as string;
    const optimization = await monetizationEngine.optimize(projectId);
    res.json({ success: true, optimization });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/monetization/optimal-time/:channelId', async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId as string;
    const time = await monetizationEngine.getOptimalUploadTime(channelId);
    const delayMs = await monetizationEngine.getUploadDelayMs(channelId);
    res.json({ success: true, optimalTime: time, delayMs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
