import { register, Counter, Gauge, Histogram } from 'prom-client';

register.clear();

// ─── Upload Metrics ──────────────────────────────────────────────────────────
export const youtubeUploadsTotal = new Counter({
  name: 'youtube_uploads_total',
  help: 'Total YouTube uploads',
  labelNames: ['status', 'channel', 'priority_tier'],
});

export const youtubeQuotaRemaining = new Gauge({
  name: 'youtube_quota_remaining',
  help: 'Remaining YouTube API quota units',
  labelNames: ['channel'],
});

export const uploadDuration = new Histogram({
  name: 'upload_duration_seconds',
  help: 'Histogram of YouTube upload durations',
  labelNames: ['channel'],
  buckets: [10, 30, 60, 120, 180, 300, 600],
});

// ─── Queue Metrics ───────────────────────────────────────────────────────────
export const queueDepth = new Gauge({
  name: 'queue_depth',
  help: 'Current queue depth per priority tier',
  labelNames: ['queue_name', 'tier'],
});

export const queueFailed = new Gauge({
  name: 'queue_failed_total',
  help: 'Failed jobs per queue',
  labelNames: ['queue_name'],
});

export const queueCompleted = new Counter({
  name: 'queue_completed_total',
  help: 'Completed jobs per queue',
  labelNames: ['queue_name', 'status'],
});

export const queueLatency = new Histogram({
  name: 'queue_job_latency_seconds',
  help: 'Time from enqueue to processing start',
  labelNames: ['queue_name'],
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
});

// ─── Worker Metrics ──────────────────────────────────────────────────────────
export const workerActiveJobs = new Gauge({
  name: 'worker_active_jobs',
  help: 'Active jobs per worker',
  labelNames: ['worker_name', 'worker_id'],
});

export const workerHeartbeatAge = new Gauge({
  name: 'worker_heartbeat_age_seconds',
  help: 'Age of last worker heartbeat',
  labelNames: ['worker_id', 'queue'],
});

export const workerCount = new Gauge({
  name: 'worker_count',
  help: 'Number of active workers',
  labelNames: ['queue'],
});

// ─── Render Metrics ──────────────────────────────────────────────────────────
export const renderDuration = new Histogram({
  name: 'render_duration_seconds',
  help: 'Histogram of FFmpeg render durations',
  labelNames: ['encoder', 'scenes'],
  buckets: [30, 60, 120, 180, 300, 600, 900, 1200, 1800],
});

export const renderOutputSize = new Gauge({
  name: 'render_output_size_bytes',
  help: 'Output file size per render',
  labelNames: ['encoder'],
});

export const renderRetries = new Counter({
  name: 'render_retries_total',
  help: 'Total render retry attempts',
  labelNames: ['encoder'],
});

// ─── Pipeline Metrics ────────────────────────────────────────────────────────
export const pipelineStepDuration = new Histogram({
  name: 'pipeline_step_duration_seconds',
  help: 'Duration per pipeline step',
  labelNames: ['step', 'status', 'tier'],
  buckets: [5, 10, 30, 60, 120, 300, 600],
});

export const pipelineStepCounter = new Counter({
  name: 'pipeline_step_total',
  help: 'Pipeline step completions',
  labelNames: ['step', 'status', 'tier'],
});

// ─── Circuit Breaker Metrics ─────────────────────────────────────────────────
export const circuitBreakerState = new Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['name'],
});

export const circuitBreakerTrips = new Counter({
  name: 'circuit_breaker_trips_total',
  help: 'Number of circuit breaker state transitions',
  labelNames: ['name', 'from_state', 'to_state'],
});

// ─── API Metrics ─────────────────────────────────────────────────────────────
export const apiRequestDuration = new Histogram({
  name: 'api_request_duration_seconds',
  help: 'API request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
});

export const apiRequestTotal = new Counter({
  name: 'api_requests_total',
  help: 'Total API requests',
  labelNames: ['method', 'route', 'status_code'],
});

// ─── DLQ Metrics ─────────────────────────────────────────────────────────────
export const dlqTotal = new Gauge({
  name: 'dlq_total',
  help: 'Total dead letter queue entries',
  labelNames: ['reason'],
});

export const dlqRetriesScheduled = new Counter({
  name: 'dlq_retries_scheduled_total',
  help: 'Total DLQ retries scheduled',
  labelNames: ['queue_name'],
});

export const dlqRetriesExecuted = new Counter({
  name: 'dlq_retries_executed_total',
  help: 'Total DLQ retries executed',
  labelNames: ['queue_name', 'success'],
});

// ─── Revenue Metrics ─────────────────────────────────────────────────────────
export const estimatedRevenue = new Gauge({
  name: 'estimated_revenue_usd',
  help: 'Estimated revenue per project',
  labelNames: ['channel', 'confidence'],
});

export const revenuePerChannel = new Gauge({
  name: 'revenue_per_channel_usd',
  help: 'Total estimated revenue per channel',
  labelNames: ['channel', 'period'],
});

export const rpmPerChannel = new Gauge({
  name: 'rpm_per_channel',
  help: 'Revenue per mille per channel',
  labelNames: ['channel'],
});

// ─── Quality Gate Metrics ────────────────────────────────────────────────────
export const qualityGateScore = new Gauge({
  name: 'quality_gate_score',
  help: 'Quality gate overall score per project',
  labelNames: ['project_id', 'check_name'],
});

export const qualityGatePassed = new Counter({
  name: 'quality_gate_passed_total',
  help: 'Quality gate results',
  labelNames: ['result', 'auto_fixed'],
});

// ─── Auto-Scaling Metrics ────────────────────────────────────────────────────
export const scalingActions = new Counter({
  name: 'scaling_actions_total',
  help: 'Auto-scaling actions taken',
  labelNames: ['type', 'severity'],
});

export const scalingFlags = new Gauge({
  name: 'scaling_flags',
  help: 'Current auto-scaling flag values',
  labelNames: ['flag'],
});

// ─── Error Metrics ───────────────────────────────────────────────────────────
export const errorRate = new Counter({
  name: 'error_total',
  help: 'Total errors by service',
  labelNames: ['service', 'error_type'],
});

export const errorRatePerMinute = new Gauge({
  name: 'error_rate_per_minute',
  help: 'Error rate per minute by service',
  labelNames: ['service'],
});

// ─── System Metrics ──────────────────────────────────────────────────────────
export const cpuUsage = new Gauge({
  name: 'system_cpu_usage_percent',
  help: 'Current CPU usage percentage',
});

export const memoryUsage = new Gauge({
  name: 'system_memory_usage_percent',
  help: 'Current memory usage percentage',
});

export const diskUsage = new Gauge({
  name: 'system_disk_usage_bytes',
  help: 'Disk usage by directory',
  labelNames: ['directory'],
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
export async function getMetricsContentType(): Promise<string> {
  return register.contentType;
}

export async function getMetrics(): Promise<string> {
  return register.metrics();
}
