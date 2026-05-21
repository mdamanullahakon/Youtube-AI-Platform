import { Request, Response } from 'express';
import { AutoPipelineOrchestrator } from '../services/auto-pipeline-orchestrator.service';
import { logger } from '../utils/logger';

export async function runAutoPipelineHandler(req: Request, res: Response) {
  const userId = (req as any).userId;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  logger.info('[AUTO_PIPELINE] Manual trigger by user ' + userId);

  const orchestrator = new AutoPipelineOrchestrator();
  const result = await orchestrator.runDaily(userId);

  if (result.success) {
    return res.status(200).json({
      success: true,
      message: 'Auto pipeline completed successfully',
      data: result,
    });
  } else {
    return res.status(500).json({
      success: false,
      message: result.error || 'Auto pipeline failed',
      data: result,
    });
  }
}
