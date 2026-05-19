// dotenv must load BEFORE any local imports to ensure env vars are available
// (worker modules read process.env at import time)
// Using require() instead of import because import is hoisted and runs after
// all module-level require() calls, defeating the purpose of early env loading
require('dotenv').config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import cookieParser from 'cookie-parser';

import authRoutes from './routes/auth.routes';
import trendsRoutes from './routes/trends.routes';
import scriptsRoutes from './routes/scripts.routes';
import videosRoutes from './routes/videos.routes';
import uploadRoutes from './routes/upload.routes';
import analyticsRoutes from './routes/analytics.routes';
import transcriptsRoutes from './routes/transcripts.routes';
import transcriptIntelligenceRoutes from './routes/transcript-intelligence.routes';
import analyticsLearningRoutes from './routes/analytics-learning.routes';
import queueRoutes from './routes/queues.routes';
import storageRoutes from './routes/storage.routes';
import youtubeAuthRoutes from './routes/youtube-auth.routes';
import businessRoutes from './routes/business.routes';
import godmodeRoutes from './routes/godmode.routes';
import horrorRoutes from './routes/horror.routes';
import keysRoutes from './routes/keys.routes';
import configRoutes from './routes/config.routes';
import deployRoutes from './routes/deploy.routes';
import intelligenceRoutes from './routes/intelligence.routes';
import aiControlRoutes from './routes/ai-control.routes';
import contentPlanRoutes from './routes/content-plan.routes';
import businessDashboardRoutes from './routes/business-dashboard.routes';

import { errorHandler } from './middleware/errorHandler';
import { redisRateLimiter, securityHeaders, validateApiKey } from './services/security.service';

import { logger } from './utils/logger';
import { prisma } from './config/db';
import { redisConnection } from './config/redis';

import { startDeadLetterProcessing, stopDeadLetterProcessing } from './workers/dead-letter.worker';
import { ALL_QUEUES, queueMap, dlqMap } from './queues/video.queue';
import { queueLogger } from './utils/logger';
import { scheduleCleanupJobs } from './workers/cleanup.worker';
import { StorageManager } from './services/storage.service';
import { storageGuard, storageGuardForRender } from './middleware/storageGuard';
import { createCsrfMiddleware } from './middleware/csrf';
import { disconnectDatabase } from './config/db';
import { disconnectRedis } from './config/redis';
import { validateEnvironment } from './utils/env-validator';
import { validateStartup, formatStartupReport } from './utils/startup-validator';
import { validateOAuthCredentials, formatOAuthReport } from './utils/oauth-validator';
import { initializeSchedulers } from './services/scheduler.service';
import { MonitoringService } from './services/monitoring.service';
import { applySecurityMiddleware } from './middleware/security.middleware';
import { requestId } from './middleware/requestId';

let redisAvailable = false;
let workersStarted = false;

async function checkRedisAvailable(): Promise<boolean> {
  try {
    const redis = (await import('./config/redis')).redisConnection;
    if (redis.status !== 'ready') {
      await redis.connect();
      await redis.ping();
    }
    const info = await redis.info('server');
    const versionMatch = info.match(/redis_version:(\d+)\.\d+\.\d+/);
    const major = versionMatch ? parseInt(versionMatch[1], 10) : 0;
    if (major < 5) {
      logger.warn(`Redis version ${versionMatch?.[1] || '?'} detected. BullMQ requires 5+. Queues disabled.`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function startWorkersIfRedisAvailable() {
  if (workersStarted) return;
  redisAvailable = await checkRedisAvailable();
  if (!redisAvailable) {
    logger.warn('Redis unavailable — skipping worker startup. API will run without queues.');
    return;
  }

  workersStarted = true;

  // Lazy-import workers only when Redis is confirmed available
  await Promise.allSettled([
    import('./workers/video.worker'),
    import('./workers/trend.worker'),
    import('./workers/script.worker'),
    import('./workers/render.worker'),
    import('./workers/upload.worker'),
    import('./workers/analytics.worker'),
    import('./workers/agent.worker'),
    import('./workers/transcript.worker'),
    import('./workers/cleanup.worker'),
    import('./services/income-system-v2/income.workers'),
  ]);

  // Wire up dead-letter queue forwarding
  for (const { name, events, dlq } of ALL_QUEUES) {
    events.on('failed', async ({ jobId, failedReason }) => {
      try {
        const queue = queueMap[name];
        if (!queue) return;
        const job = await queue.getJob(jobId);
        if (!job) return;
        const safeData = JSON.parse(JSON.stringify(job.data, (key, val) => {
          if (key === 'socket' || key === 'parser' || key === '_httpMessage' || key === 'req' || key === 'res') return undefined;
          if (typeof val === 'object' && val !== null) {
            const proto = Object.prototype.toString.call(val);
            if (proto === '[object Object]' || proto === '[object Array]') return val;
            try { JSON.stringify(val); return val; } catch { return undefined; }
          }
          return val;
        }));
        await dlq.add(job.name, {
          ...safeData,
          __queueName: name,
          __jobName: job.name,
          __failReason: failedReason,
          __attempts: job.attemptsMade,
        });
        queueLogger.warn(`Failed job ${jobId} forwarded to DLQ ${dlq.name}`);
      } catch (err: any) {
        queueLogger.warn(`DLQ forwarding skipped for ${jobId}: ${err.message}`);
      }
    });
  }
}

// Load env with requireEnv validation (fatals if JWT secrets missing)
try {
  require('./config/env');
} catch (err: any) {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
}

// Validate critical environment variables on boot
const envCheck = validateEnvironment();
if (!envCheck.valid) {
  for (const err of envCheck.errors) {
    console.error(`[ENV] ${err}`);
  }
  process.exit(1);
}
for (const warn of envCheck.warnings) {
  if (warn) console.warn(`[ENV] Warning: ${warn}`);
}

const app = express();

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

const allowedOrigins = new Set([
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map(s => s.trim()) : []),
  'http://localhost:3000',
  'http://localhost:3001',
]);

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-access-token'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
};

app.use(cors(corsOptions));
// OPTIONS preflight handled by cors middleware via app.use(cors(...)) above

app.use(securityHeaders);
app.use(validateApiKey);
app.use(cookieParser());
applySecurityMiddleware(app);

app.use(requestId);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
morgan.token('request-id', (req) => (req as any).id || '-');
app.use(morgan(':method :url :status :response-time ms - :request-id'));
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 5000) {
      logger.warn(`Slow request`, { method: req.method, url: req.url, status: res.statusCode, durationMs: duration, requestId: (req as any).id });
    }
  });
  next();
});
app.use('/api/', redisRateLimiter);

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Storage guards (must be before routes to intercept requests)
app.use('/api/videos/render', storageGuardForRender);
app.use('/api/videos/generate', storageGuard);
app.use('/api/upload', storageGuard);

// CSRF protection for cookie-based auth
const csrfOrigins = [...allowedOrigins];
app.use(createCsrfMiddleware(csrfOrigins));

// Independent health endpoint (no dependencies) — for load balancers / monitoring
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    pid: process.pid,
  });
});

// Fallback health endpoint (no MonitoringService dep) — for when MonitoringService fails
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0',
  });
});

// Route registrations
app.use('/api/auth', authRoutes);
app.use('/api/trends', trendsRoutes);
app.use('/api/scripts', scriptsRoutes);
app.use('/api/videos', videosRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/transcripts', transcriptsRoutes);
app.use('/api/transcript-intelligence', transcriptIntelligenceRoutes);
app.use('/api/analytics-learning', analyticsLearningRoutes);
app.use('/api/queues', queueRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/auth/youtube', youtubeAuthRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/godmode', godmodeRoutes);
app.use('/api/horror', horrorRoutes);
app.use('/api/keys', keysRoutes);
app.use('/api/config', configRoutes);
app.use('/api/deploy', deployRoutes);
app.use('/api/intelligence', intelligenceRoutes);
app.use('/api/ai-control', aiControlRoutes);
app.use('/api/content-plan', contentPlanRoutes);
app.use('/api/business-dashboard', businessDashboardRoutes);

app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'YouTube AI Platform API',
    version: '1.0.0',
    health: '/health',
    'health-deep': '/api/health/deep',
    endpoints: {
      auth: ['POST /api/auth/register', 'POST /api/auth/login', 'POST /api/auth/refresh', 'POST /api/auth/logout', 'POST /api/auth/logout-all', 'GET /api/auth/sessions', 'DELETE /api/auth/sessions/:jti', 'POST /api/auth/forgot-password', 'POST /api/auth/reset-password', 'GET /api/auth/profile', 'PUT /api/auth/profile', 'PUT /api/auth/settings'],
      trends: ['POST /api/trends/analyze', 'GET /api/trends/history'],
      scripts: ['POST /api/scripts/generate/:projectId'],
      videos: ['POST /api/videos/generate/:projectId', 'POST /api/videos/render/:projectId', 'GET /api/videos/status/:projectId'],
      upload: ['POST /api/upload/youtube/:projectId', 'GET /api/upload/history'],
      analytics: ['GET /api/analytics/dashboard', 'GET /api/analytics/projects', 'GET /api/analytics/project/:projectId'],
      transcripts: ['POST /api/transcripts/analyze'],
      config: ['GET /api/config/status', 'GET /api/config/missing', 'POST /api/config/set', 'POST /api/config/test', 'POST /api/config/assistant', 'DELETE /api/config/:key'],
      'transcript-intelligence': [
        'POST /api/transcript-intelligence/analyze',
        'POST /api/transcript-intelligence/analyze-text',
        'GET /api/transcript-intelligence/insights',
        'GET /api/transcript-intelligence/insights/:id/apply',
        'GET /api/transcript-intelligence/script-improvements',
        'GET /api/transcript-intelligence/project/:projectId',
        'GET /api/transcript-intelligence/performance-correlation',
      ],
      'analytics-learning': [
        'POST /api/analytics-learning/analyze/:projectId',
        'GET /api/analytics-learning/correlations',
        'GET /api/analytics-learning/thumbnails/analysis',
        'GET /api/analytics-learning/thumbnails/:projectId',
        'GET /api/analytics-learning/retention/:projectId',
        'GET /api/analytics-learning/learning/:projectId',
        'GET /api/analytics-learning/global-report',
        'GET /api/analytics-learning/cross-project',
        'GET /api/analytics-learning/performance-records',
        'GET /api/analytics-learning/script-feedback',
        'POST /api/analytics-learning/predict-thumbnail-ctr',
        'POST /api/analytics-learning/save-thumbnail-performance',
      ],
      business: [
        'GET /api/business/dashboard',
        'POST /api/business/viral/scan',
        'GET /api/business/viral/opportunities',
        'POST /api/business/patterns/extract',
        'GET /api/business/patterns',
        'POST /api/business/retention/score',
        'POST /api/business/retention/optimize',
        'POST /api/business/thumbnails/generate',
        'POST /api/business/titles/generate',
        'GET /api/business/monetization',
        'POST /api/business/analyze',
        'POST /api/business/schedule',
        'GET /api/business/strategies',
        'GET /api/business/strategies/:niche',
        'POST /api/business/cleanup',
        'POST /api/business/ctr/predict-thumbnail',
        'POST /api/business/ctr/predict-title',
        'POST /api/business/retention/simulate',
        'GET /api/business/retention/curve/:projectId',
        'POST /api/business/monetization/predict',
        'POST /api/business/ab-testing/create',
        'POST /api/business/ab-testing/record',
        'GET /api/business/ab-testing/:projectId',
        'GET /api/business/ab-testing/best-variant/:testType',
        'GET /api/business/upload-time/best/:channelId',
        'POST /api/business/upload-time/track',
        'POST /api/business/quality/humanize',
        'POST /api/business/quality/emotional-depth',
        'POST /api/business/quality/pacing',
        'POST /api/business/quality/enhance',
      ],
      deploy: ['POST /api/deploy/vercel', 'POST /api/deploy/vps', 'GET /api/deploy/status'],
      'business-dashboard': [
        'GET /api/business-dashboard/dashboard',
        'GET /api/business-dashboard/cross-channel',
        'GET /api/business-dashboard/revenue/channel/:channelId',
        'GET /api/business-dashboard/revenue/video/:projectId',
        'POST /api/business-dashboard/orchestrate/daily',
      ],
      'ai-control': [
        'GET /api/ai-control/status',
        'GET /api/ai-control/automation',
        'POST /api/ai-control/automation/start',
        'POST /api/ai-control/automation/stop',
        'GET /api/ai-control/errors',
        'POST /api/ai-control/errors/fix/:errorId',
        'POST /api/ai-control/errors/fix-all',
        'GET /api/ai-control/viral-opportunities',
        'GET /api/ai-control/winning-patterns',
        'GET /api/ai-control/channel-metrics',
        'POST /api/ai-control/generate-video',
        'POST /api/ai-control/regenerate-script/:projectId',
      ],
      godmode: [
        'POST /api/godmode/initialize',
        'POST /api/godmode/scan',
        'POST /api/godmode/analyze',
        'GET /api/godmode/niche-recommendations',
        'POST /api/godmode/video-idea',
        'POST /api/godmode/generate-script',
        'POST /api/godmode/generate-roadmap',
        'POST /api/godmode/launch-blueprint',
        'GET /api/godmode/execution-plan/:niche',
        'POST /api/godmode/title-variants',
        'POST /api/godmode/hook-variants',
        'GET /api/godmode/predictions',
      ],
    },
  });
});

// Deep health check with MonitoringService (DB, Redis, memory, queues)
app.get('/api/health/deep', async (req, res) => {
  const force = req.query.force === 'true';
  try {
    const report = await MonitoringService.getHealth(force);
    res.status(report.success ? 200 : 503).json(report);
  } catch (err: any) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      error: err.message,
    });
  }
});

// Prometheus metrics endpoint
app.get('/api/metrics', async (_req, res) => {
  try {
    const metrics = await MonitoringService.getPrometheusMetrics();
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  } catch (err: any) {
    res.status(500).send(`# Error generating metrics: ${err.message}\n`);
  }
});

// JSON 404 handler for unmatched API routes
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use(errorHandler);

// ─── Graceful Shutdown ───────────────────────
let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`${signal} received. Starting graceful shutdown...`);

  const shutdownTimeout = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);

  try {
    if (workersStarted && typeof stopDeadLetterProcessing === 'function') stopDeadLetterProcessing();
    logger.info('Workers drained. Closing connections...');
    await disconnectDatabase().catch(() => {});
    await disconnectRedis().catch(() => {});
    logger.info('All connections closed. Goodbye.');
    clearTimeout(shutdownTimeout);
    process.exit(0);
  } catch (err: any) {
    logger.error('Error during shutdown', { error: err.message });
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors — do NOT shut down for transient Redis connection errors
// ioredis can emit uncaught exceptions on stale TCP sockets after Redis restart
process.on('uncaughtException', (err) => {
  const errMsg = err.message || '';
  const errCode = (err as any).code || '';
  const isRedisConnectionError = errMsg.includes('ECONNREFUSED') || errMsg.includes('ECONNABORTED') || errMsg.includes('Redis') || errCode === 'ECONNREFUSED' || errCode === 'ECONNABORTED';
  if (isRedisConnectionError) {
    logger.warn('Redis connection error (suppressing crash — ioredis will reconnect)', { error: errMsg, code: errCode });
    return;
  }
  logger.error('Uncaught exception', { error: err.message, code: errCode, stack: err.stack });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  const err = reason as any;
  const msg = err?.message || '';
  const code = err?.code || '';
  const isQueueWorkerError = !msg && !code && typeof reason === 'object';
  const isRedisError = msg.includes('ECONNREFUSED') || msg.includes('Redis') || msg.includes('version') || code === 'ECONNREFUSED';
  if (isQueueWorkerError || isRedisError) {
    return;
  }
  if (msg) {
    logger.warn('Unhandled rejection', { reason: msg });
  }
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, async () => {
  const startupReport = await validateStartup();
  const formatted = formatStartupReport(startupReport);
  console.log(formatted);

  if (!startupReport.passed) {
    logger.warn('Startup validation found issues. Check above for details.');
  }

  // Start workers after Redis check
  await startWorkersIfRedisAvailable();

  // ─── YouTube OAuth deep validation ──────────────────────
  try {
    const oauthResult = await validateOAuthCredentials();
    console.log(formatOAuthReport(oauthResult));
  } catch (err: any) {
    logger.warn(`OAuth validation skipped: ${err.message}`);
  }

  await StorageManager.ensureDirectories();
  if (redisAvailable) {
    await scheduleCleanupJobs().catch(err => logger.error('Failed to schedule cleanup jobs', { error: err.message }));
    initializeSchedulers();
    startDeadLetterProcessing();
  } else {
    logger.info('Redis unavailable — schedulers and dead-letter processing skipped.');
  }
  logger.info(`╔═══════════════════════════════════════════╗`);
  logger.info(`║  YouTube AI Platform API                  ║`);
  logger.info(`║  Port: ${PORT}                               ║`);
  logger.info(`║  Env: ${(process.env.NODE_ENV || 'development').padEnd(12)}               ║`);
  logger.info(`║  Frontend: ${process.env.FRONTEND_URL || 'http://localhost:3000'} ║`);
  logger.info(`╚═══════════════════════════════════════════╝`);
});

export default app;
