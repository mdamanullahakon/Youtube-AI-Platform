import { Request, Response } from 'express';
import { createScriptToRenderFlow } from '../queues/pipeline.queue';

export async function enqueuePipeline(req: Request, res: Response) {
  const { projectId, topic, channelId } = req.body;
  if (!projectId || !topic) return res.status(400).json({ error: 'projectId and topic are required' });

  try {
    const flow = await createScriptToRenderFlow(projectId, channelId || undefined);
    return res.status(202).json({ pipelineId: flow.pipelineJobId, tree: !!flow.tree });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'failed to create pipeline' });
  }
}

export default { enqueuePipeline };