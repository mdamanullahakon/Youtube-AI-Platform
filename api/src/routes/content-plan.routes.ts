import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { horrorContentScheduler } from '../services/horror-content-scheduler.service';

const router = Router();

router.get('/plan', authenticate, async (req: Request, res: Response) => {
  try {
    const dateParam = req.query.date as string | undefined;
    const plan = await horrorContentScheduler.getDailyPlan(dateParam);

    if (!plan) {
      const fresh = await horrorContentScheduler.createDailyPlan();
      return res.json({ success: true, data: fresh });
    }

    res.json({ success: true, data: plan });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || 'Failed to get daily plan' });
  }
});

router.post('/plan/generate', authenticate, async (_req: Request, res: Response) => {
  try {
    const plan = await horrorContentScheduler.createDailyPlan();
    res.json({ success: true, data: plan, message: 'Daily plan created' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message || 'Failed to create plan' });
  }
});

export default router;
