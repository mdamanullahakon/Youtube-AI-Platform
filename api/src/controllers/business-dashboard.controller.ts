import { Request, Response } from 'express';
import { RevenueTrackingService } from '../services/revenue-tracking.service';
import { MultiChannelOrchestrator } from '../services/multi-channel-orchestrator.service';
import { logger } from '../utils/logger';

const revenueTracker = new RevenueTrackingService();
const orchestrator = new MultiChannelOrchestrator();

export async function getBusinessDashboardHandler(req: Request, res: Response) {
  try {
    const userId = (req as any).userId;
    const dashboard = await revenueTracker.getBusinessDashboard(userId);
    res.json({ success: true, data: dashboard });
  } catch (err: any) {
    logger.error(`Business dashboard failed: ${err.message}`);
    res.status(500).json({ success: false, message: 'Failed to load business dashboard' });
  }
}

export async function getChannelRevenueHandler(req: Request, res: Response) {
  try {
    const channelId = req.params.channelId as string;
    const report = await revenueTracker.getChannelRevenueReport(channelId);
    if (!report) return res.status(404).json({ success: false, message: 'Channel not found' });
    res.json({ success: true, data: report });
  } catch (err: any) {
    logger.error(`Channel revenue failed: ${err.message}`);
    res.status(500).json({ success: false, message: 'Failed to load channel revenue report' });
  }
}

export async function getVideoRevenueHandler(req: Request, res: Response) {
  try {
    const projectId = req.params.projectId as string;
    const revenue = await revenueTracker.getVideoRevenue(projectId);
    if (!revenue) return res.status(404).json({ success: false, message: 'Project not found or not published' });
    res.json({ success: true, data: revenue });
  } catch (err: any) {
    logger.error(`Video revenue failed: ${err.message}`);
    res.status(500).json({ success: false, message: 'Failed to load video revenue' });
  }
}

export async function getCrossChannelDashboardHandler(req: Request, res: Response) {
  try {
    const userId = (req as any).userId;
    const report = await orchestrator.getCrossChannelDashboard(userId);
    if (!report) return res.status(200).json({ success: true, data: null, message: 'No connected channels found' });
    res.json({ success: true, data: report });
  } catch (err: any) {
    logger.error(`Cross-channel dashboard failed: ${err.message}`);
    res.status(500).json({ success: false, message: 'Failed to load cross-channel dashboard' });
  }
}

export async function runDailyOrchestrationHandler(req: Request, res: Response) {
  try {
    logger.info('[Manual trigger] Running daily orchestration');
    const report = await orchestrator.runDailyOrchestration();
    res.json({ success: true, data: report, message: 'Daily orchestration completed' });
  } catch (err: any) {
    logger.error(`Daily orchestration failed: ${err.message}`);
    res.status(500).json({ success: false, message: 'Daily orchestration failed' });
  }
}
