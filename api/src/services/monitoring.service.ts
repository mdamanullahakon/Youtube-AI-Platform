import { prisma } from '../config/db';
import { redisConnection } from '../config/redis';
import { QueueMonitor } from '../queues/monitor';
import { ALL_QUEUES, dlqMap } from '../queues/video.queue';
import { apiLogger } from '../utils/logger';

interface HealthComponent {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency: number;
  error?: string;
}

interface HealthReport {
  success: boolean;
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: Record<string, HealthComponent>;
}

interface AlertWebhook {
  url: string;
  events: AlertEventType[];
}

type AlertEventType = 'component_down' | 'queue_backup' | 'high_error_rate' | 'disk_critical';

interface AlertEvent {
  type: AlertEventType;
  severity: 'warning' | 'critical';
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface QueueMetric {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  dlqSize: number;
}

const webhooks: AlertWebhook[] = [];

let cachedHealth: HealthReport | null = null;
let lastHealthCheck = 0;
const HEALTH_CACHE_TTL = 5000;

export class MonitoringService {
  static registerWebhook(url: string, events: AlertEventType[]) {
    webhooks.push({ url, events });
    apiLogger.info('Alert webhook registered', { url, events });
  }

  static async sendAlert(event: AlertEvent) {
    for (const webhook of webhooks) {
      if (!webhook.events.includes(event.type)) continue;
      try {
        const { default: axios } = await import('axios');
        await axios.post(webhook.url, event, { timeout: 5000 });
      } catch (err: any) {
        apiLogger.error('Alert webhook failed', { url: webhook.url, error: err.message });
      }
    }

    const logLevel = event.severity === 'critical' ? 'error' : 'warn';
    apiLogger[logLevel](`[ALERT] ${event.message}`, { type: event.type, metadata: event.metadata });
  }

  static async checkComponent(
    name: string,
    checkFn: () => Promise<void>,
  ): Promise<HealthComponent> {
    const start = Date.now();
    try {
      await checkFn();
      return { status: 'healthy', latency: Date.now() - start };
    } catch (err: any) {
      return { status: 'unhealthy', latency: Date.now() - start, error: err.message };
    }
  }

  static async getHealth(force = false): Promise<HealthReport> {
    const now = Date.now();
    if (!force && cachedHealth && now - lastHealthCheck < HEALTH_CACHE_TTL) {
      return cachedHealth;
    }

    const checks: Record<string, HealthComponent> = {};

    checks.database = await MonitoringService.checkComponent('database', async () => {
      await prisma.$queryRaw`SELECT 1`;
    });

    checks.redis = await MonitoringService.checkComponent('redis', async () => {
      if (redisConnection.status !== 'ready') throw new Error('Redis not connected');
      const ping = await redisConnection.ping();
      if (ping !== 'PONG') throw new Error('Redis ping failed');
    });

    checks.memory = MonitoringService.checkMemory();

    try {
      const queueStatuses = await QueueMonitor.getQueueStatuses();
      const totalFailed = queueStatuses.reduce((s, q) => s + q.failed, 0);
      const totalDlq = queueStatuses.reduce((s, q) => s + q.dlqSize, 0);
      checks.queues = {
        status: totalDlq > 50 || totalFailed > 100 ? 'degraded' : 'healthy',
        latency: 0,
      };
    } catch (err: any) {
      checks.queues = { status: 'unhealthy', latency: 0, error: err.message };
    }

    const allHealthy = Object.values(checks).every(c => c.status === 'healthy');
    const anyUnhealthy = Object.values(checks).some(c => c.status === 'unhealthy');

    const report: HealthReport = {
      success: allHealthy,
      status: anyUnhealthy ? 'unhealthy' : allHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      checks,
    };

    cachedHealth = report;
    lastHealthCheck = now;

    if (anyUnhealthy) {
      for (const [name, component] of Object.entries(checks)) {
        if (component.status === 'unhealthy') {
          MonitoringService.sendAlert({
            type: 'component_down',
            severity: 'critical',
            message: `Component ${name} is down: ${component.error}`,
            timestamp: report.timestamp,
            metadata: { component: name, error: component.error },
          });
        }
      }
    }

    return report;
  }

  static checkMemory(): HealthComponent {
    const freeBytes = require('os').freemem();
    const totalBytes = require('os').totalmem();
    const usagePercent = Math.round((1 - freeBytes / totalBytes) * 100);
    const freeGB = freeBytes / (1024 * 1024 * 1024);

    let status: HealthComponent['status'] = 'healthy';
    if (freeBytes < 200 * 1024 * 1024) status = 'unhealthy';
    else if (freeBytes < 500 * 1024 * 1024) status = 'degraded';

    return { status, latency: usagePercent };
  }

  static async getQueueMetrics(): Promise<QueueMetric[]> {
    const statuses = await QueueMonitor.getQueueStatuses();
    return statuses.map(s => ({
      name: s.name,
      waiting: s.waiting,
      active: s.active,
      completed: s.completed,
      failed: s.failed,
      delayed: s.delayed,
      dlqSize: s.dlqSize,
    }));
  }

  static async getPrometheusMetrics(): Promise<string> {
    const mem = process.memoryUsage();
    const uptime = process.uptime();
    const lines: string[] = [];

    lines.push('# HELP yt_api_uptime_seconds Application uptime');
    lines.push('# TYPE yt_api_uptime_seconds gauge');
    lines.push(`yt_api_uptime_seconds ${uptime}`);
    lines.push('');

    lines.push('# HELP yt_api_memory_bytes Memory usage in bytes');
    lines.push('# TYPE yt_api_memory_bytes gauge');
    lines.push(`yt_api_memory_bytes{type="rss"} ${mem.rss}`);
    lines.push(`yt_api_memory_bytes{type="heapTotal"} ${mem.heapTotal}`);
    lines.push(`yt_api_memory_bytes{type="heapUsed"} ${mem.heapUsed}`);
    lines.push(`yt_api_memory_bytes{type="external"} ${mem.external}`);
    lines.push('');

    try {
      const queueMetrics = await MonitoringService.getQueueMetrics();
      lines.push('# HELP yt_api_queue_jobs Queue job counts by status');
      lines.push('# TYPE yt_api_queue_jobs gauge');
      for (const q of queueMetrics) {
        for (const status of ['waiting', 'active', 'completed', 'failed', 'delayed'] as const) {
          lines.push(`yt_api_queue_jobs{queue="${q.name}",status="${status}"} ${q[status]}`);
        }
        lines.push(`yt_api_queue_jobs{queue="${q.name}",status="dlq"} ${q.dlqSize}`);
      }
      lines.push('');

      const totalFailed = queueMetrics.reduce((s, q) => s + q.failed, 0);
      const totalDlq = queueMetrics.reduce((s, q) => s + q.dlqSize, 0);
      lines.push('# HELP yt_api_queue_failed_total Total failed jobs across all queues');
      lines.push('# TYPE yt_api_queue_failed_total gauge');
      lines.push(`yt_api_queue_failed_total ${totalFailed}`);
      lines.push('');

      lines.push('# HELP yt_api_queue_dlq_total Total dead-letter queue jobs');
      lines.push('# TYPE yt_api_queue_dlq_total gauge');
      lines.push(`yt_api_queue_dlq_total ${totalDlq}`);
      lines.push('');
    } catch {}

    lines.push('# HELP yt_api_health_status Overall health status (1=healthy, 0=unhealthy)');
    lines.push('# TYPE yt_api_health_status gauge');
    try {
      const health = await MonitoringService.getHealth();
      lines.push(`yt_api_health_status ${health.success ? 1 : 0}`);
    } catch {
      lines.push('yt_api_health_status 0');
    }

    return lines.join('\n');
  }
}
