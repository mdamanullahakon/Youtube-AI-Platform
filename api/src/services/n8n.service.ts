import axios from 'axios';
import { logger } from '../utils/logger';

interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  nodes: any[];
  connections: any;
}

interface N8nExecution {
  id: string;
  workflowId: string;
  status: 'running' | 'success' | 'error';
  startedAt: string;
  finishedAt?: string;
  data?: any;
}

export class N8nService {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.N8N_URL || 'http://localhost:5678';
    this.apiKey = process.env.N8N_API_KEY || '';
  }

  private get headers() {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['X-N8N-API-KEY'] = this.apiKey;
    return headers;
  }

  async triggerWorkflow(workflowId: string, data: Record<string, unknown>): Promise<N8nExecution | null> {
    try {
      if (!this.apiKey) {
        logger.warn('N8N not configured (no API key)');
        return null;
      }

      const response = await axios.post(
        `${this.baseUrl}/api/v1/workflows/${workflowId}/execute`,
        { data },
        { headers: this.headers, timeout: 10000 }
      );

      logger.info(`N8N workflow ${workflowId} triggered`);
      return response.data;
    } catch (error: any) {
      logger.error('N8N trigger failed', { error: error.message });
      return null;
    }
  }

  async triggerVideoPipeline(projectId: string, videoUrl: string, metadata: Record<string, unknown>) {
    const workflowId = process.env.N8N_VIDEO_WORKFLOW_ID || '';
    if (!workflowId) {
      logger.info('No N8N video workflow configured, skipping');
      return null;
    }

    return this.triggerWorkflow(workflowId, {
      projectId,
      videoUrl,
      metadata,
      timestamp: new Date().toISOString(),
    });
  }

  async triggerAnalyticsPipeline(projectId: string, analytics: Record<string, unknown>) {
    const workflowId = process.env.N8N_ANALYTICS_WORKFLOW_ID || '';
    if (!workflowId) {
      logger.info('No N8N analytics workflow configured, skipping');
      return null;
    }

    return this.triggerWorkflow(workflowId, {
      projectId,
      analytics,
      timestamp: new Date().toISOString(),
    });
  }

  async listWorkflows(): Promise<N8nWorkflow[]> {
    try {
      if (!this.apiKey) return [];
      const response = await axios.get(`${this.baseUrl}/api/v1/workflows`, {
        headers: this.headers,
        timeout: 10000,
      });
      return response.data.data || [];
    } catch {
      return [];
    }
  }
}

export const n8nService = new N8nService();
