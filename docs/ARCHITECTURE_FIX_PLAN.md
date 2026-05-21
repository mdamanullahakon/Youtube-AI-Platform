# YouTube AI Platform — Production Hardening Architecture Plan

## Table of Contents
1. [Architecture Diagnosis](#1-architecture-diagnosis)
2. [Fix Plan (Step-by-Step)](#2-fix-plan-step-by-step)
3. [New Target Architecture](#3-new-target-architecture)
4. [Code Patch Strategy](#4-code-patch-strategy)
5. [Final Production Score Improvement](#5-final-production-score-improvement)

---

## 1. Architecture Diagnosis

### 1.1 What Is Broken

| # | Component | Root Cause | Why It Breaks at Scale |
|---|-----------|-----------|----------------------|
| 1 | **InMemoryQueue** (income-v2) | Map-based job storage with `setTimeout` execution. No persistence, no IPC, no visibility. | Every process restart loses ALL pending jobs. Cannot distribute work across workers. Zero crash recovery. |
| 2 | **BullMQ Proxy Pattern** (`video.queue.ts`) | `Proxy`-based lazy initialization defers queue construction. Method resolution edge cases, confusing stack traces. | Obscure bugs when queue is used before Redis connects. Silent failures on Symbol/instanceof operations. |
| 3 | **FlowProducer Chain-Kill** (`pipeline.queue.ts`) | Single FlowProducer DAG. Root job failure cancels ALL children. | A trend-analysis blip kills a completed render. Wasted compute time grows linearly with pipeline depth. At 100 videos/day, ~30% waste from transient failures. |
| 4 | **Render Worker Concurrency 1** | `concurrency: 1` + `lockDuration: 600s`. Only one render at a time globally. | 10 videos × 5 min each = 50 min render time. At 100 channels, render backlog becomes infinite. |
| 5 | **YouTube Quota Blindness** | No pre-flight quota check. No daily tracking. Retries burn remaining quota. | At 10K units/day, 6 failed uploads exhaust quota. Next 4 channels get zero uploads. System keeps failing silently. |
| 6 | **Express No Timeout** | No `server.timeout` or middleware timeout on any route. | A stalled YouTube upload holds a connection indefinitely. At ~65K concurrent connections, Node.js heap explodes. Real limit hit much sooner due to memory per connection. |
| 7 | **Prisma Pool=4** | Default connection pool of 4. Each worker needs 2-3 queries. | With 8 workers × 2 queries + Express handlers = 20+ concurrent queries. Pool exhausts in 2 seconds. `Prisma.PoolError` cascades across all pipelines. |
| 8 | **Hardcoded Windows Fonts** | `C:\\Windows\\Fonts\\arial.ttf` in `render.service.ts` and `auto-pipeline-orchestrator.ts`. | Docker/Linux deployment = render failure. No graceful fallback. |
| 9 | **start-all.js Blocking Upload** | `await triggerTestUpload()` in main flow. Upload failure = startup failure. | 60s+ startup delay on OAuth misconfig. System never starts. No way to bypass without code edit. |
| 10 | **console.log Firehose** | ~40+ files using `console.log/warn/error`. No structured format, no levels, no correlation IDs. | Production debugging requires grep. No log aggregation possible. No per-request traceability. |
| 11 | **No Circuit Breakers** | YouTube, AI, FFmpeg calls have no backoff beyond simple retry. | A failing external service triggers cascade failures: every request retries 3-5 times, amplifying load 5×. |
| 12 | **Multiple Startup Paths** | 5 entry points with different health/restart/error behavior. | Bugs reproduced in one path don't reproduce in another. Ops confusion about which path is canonical. |

### 1.2 Why It Breaks at Scale

**At 10 channels (1 video/day each):**
- Render backlog: ~50 min sequential render time
- YouTube quota: ~16,000 units needed (10 uploads × 1,600). Single project quota = 10K. 6 channels succeed, 4 fail.
- DB pool: 4 connections for 10 concurrent pipelines → immediate pool exhaustion
- Queue persistence: InMemoryQueue loses schedule data every 24h restart → missed uploads

**At 100 channels (1 video/day each):**
- Render backlog: ~500 min = 8.3 hours. Physically impossible to keep up.
- YouTube quota: 160K units needed. Need 16 separate Google Cloud projects.
- Workers: Single Express process cannot handle 100 concurrent renders + API requests.
- Crash recovery: Every crash loses InMemoryQueue data. With daily restarts, ~50% of jobs never execute.

**Revenue impact:**
- Each failed upload = $0 revenue + wasted quota + wasted compute
- At 50% failure rate (conservative), a 10-channel system generates 50% of potential revenue
- At $5K/month potential → $2.5K actual → $30K/year lost to architectural debt

---

## 2. Fix Plan (Step-by-Step)

### Phase 1: Foundation (Must Fix — Blocks Everything Else)

```
Week 1-2:   Queue System Replacement
Week 2-3:   Startup System Fix
Week 3-4:   Express Stability
```

**Step 1: Replace InMemoryQueue with BullMQ** (Week 1)
- Prerequisite: Redis running (already in docker-compose)
- Files: `in-memory-queue.ts` (DELETE), `income.queue.ts` (REWRITE), `income.workers.ts` (REWRITE)
- Action: Create `income.queues.ts` with 8 BullMQ queues. Create `income.workers.ts` using BullMQ Worker. Keep same job handlers, same queue names, same data shapes.
- Verify: `QueueMonitor` can see income queue status. Workers persist across restart.

**Step 2: Remove BullMQ Proxy Pattern** (Week 1)
- Files: `video.queue.ts` (REWRITE)
- Action: Replace Proxy with direct Queue instantiation using lazy singleton pattern (eager construction, cached reference). Eliminate Proxy entirely.
- Verify: All queue imports work without Proxy indirection.

**Step 3: Fix startup-all.js — Non-blocking** (Week 2)
- Files: `start-all.js` (REWRITE)
- Actions:
  - `runUpload()` → fire-and-forget `executeUploadLater()` that enqueues a BullMQ job
  - Health checks → purely monitoring, never block, never exit
  - Remove 3-stage retry chain from startup
  - Guarantee: script exits or shows banner within 10 seconds
  - Upload happens asynchronously via worker

**Step 4: Add Express Request Timeout** (Week 2)
- Files: `server.ts` (MODIFY), `package.json` (ADD dependency)
- Action: Add `connect-timeout` middleware with 120s global timeout. Add 300s timeout for upload routes. Return 503 on timeout.
- Verify: Hanging requests terminate after timeout. Connection pool recovers.

**Step 5: Add Structured Logging** (Week 3)
- Files: `utils/logger.ts` (REWRITE), all services (MIGRATE)
- Action: Replace `console.log` wrapper with `pino` (structured JSON, 2× faster than winston). Add `req.id` and `worker.id` to all log calls. Keep existing logger interface.
- Verify: Log output is valid NDJSON. Each entry has `level`, `time`, `msg`, `reqId`.

**Step 6: Add Request ID propagation** (Week 3)
- Files: `middleware/requestId.ts` (MODIFY), all workers (MODIFY)
- Action: BullMQ job options carry `reqId`. Workers log with `reqId`. End-to-end traceability.
- Verify: A single upload request produces correlated log entries across Express → queue → worker → OAuth → upload.

### Phase 2: Scaling (Performance & Capacity)

```
Week 4-5:   Prisma Pool + DB Connection Management
Week 5-6:   Render Farm (Multi-Worker, GPU)
Week 6-7:   YouTube Quota Manager
```

**Step 7: Prisma Connection Pool Scaling** (Week 4)
- Files: `config/db.ts` (REWRITE), `docker/docker-compose.local.yml` (MODIFY)
- Actions:
  - Add `connection_limit: 25` to Prisma datasource URL
  - Add PgBouncer sidecar to docker-compose: port 6432, pool_mode=transaction, default_pool_size=25
  - Add `DATABASE_POOL_URL` env with PgBouncer connection string
  - Prisma connects through PgBouncer in production
- Verify: 25 concurrent queries succeed. No `Prisma.PoolError`.

**Step 8: GPU FFmpeg Detection + Render Farm** (Week 5)
- Files: `services/render.service.ts` (REWRITE), `workers/render.worker.ts` (REWRITE)
- Actions:
  - Add `detectGpuEncoder()`: probes `ffmpeg -encoders` for `h264_nvenc`, `h264_qsv`, `h264_amf`
  - Modify `renderVideo()`: use NVENC when available (`-c:v h264_nvenc -preset p4 -cq 23`), fallback to x264
  - Set `concurrency: 3` on render worker (up to 3 parallel renders)
  - Add `RENDER_QUEUE_CONCURRENCY` env var (default 3)
  - Add per-job staging directories to avoid temp file conflicts
- Verify: 3 renders run in parallel. GPU encoder used on supported hardware. No temp file collisions.

**Step 9: YouTube Quota Manager** (Week 6)
- Files: NEW `services/quota-manager.service.ts`, `workers/upload.worker.ts` (MODIFY)
- Design:
  ```
  QuotaManager:
    - Uses Redis Sorted Set: `youtube:quota:usage:{date}` with score=units, member=channelId
    - On upload success: increment by 1605 units (upload + thumbnail)
    - On upload fail: increment by 1 (failed API call cost)
    - PreCheck(channelId): returns { canUpload: bool, remainingUnits: number, resetAt: timestamp }
    - Circuit breaker: if remaining < 2000, return BLOCKED; schedule retry for next UTC day
  ```
- Modify `uploadToYouTube()`: call `quotaManager.preCheck()` before API call
- Add `POST /api/admin/quota/status` endpoint for monitoring
- Verify: When quota < 2000, uploads are blocked. Auto-retry scheduled for next day. No wasted upload attempts.

**Step 10: Channel-Level Rate Limiting** (Week 6)
- Files: NEW `services/channel-limiter.service.ts`, `middleware/channelRateLimit.ts`
- Design:
  ```
  ChannelLimiter:
    - Per-channel Redis counter: `youtube:rate:channel:{channelId}` = request count per hour
    - Max 2 uploads/hour per channel (YouTube's implicit limit)
    - Max 10 uploads/day per channel (quota-conscious)
    - Uses INCR + EXPIRE for atomic rate tracking
  ```
- Middleware applied to upload routes, checked in upload worker
- Verify: Channel hitting hourly limit gets 429. Other channels unaffected.

### Phase 3: Reliability (Production Hardening)

```
Week 7-8:   Pipeline Rewrite (Checkpoint-Based)
Week 8-9:   Circuit Breakers + Metrics
Week 9-10:  FT Fix + Cross-Platform Portability
```

**Step 11: Pipeline Rewrite — Checkpoint-Based** (Week 7)
- Files: `pipeline/` directory (REWRITE), `queues/pipeline.queue.ts` (DELETE/REWRITE)
- New design:
  ```
  Pipeline table in DB:
    id | projectId | step | status | retryCount | maxRetries | error | checkpointData | createdAt | updatedAt

  Pipeline Steps (independent, NOT nested DAG):
    1. TREND_ANALYSIS    → trend.queue → mark checkpoint
    2. SCRIPT_GENERATION → script.queue → mark checkpoint  
    3. AGENT_DISPATCH    → agent.queue  → mark checkpoint (4 sub-tasks tracked independently)
    4. VIDEO_RENDER      → render.queue → mark checkpoint
    5. OUTPUT_VALIDATION → inline check → mark checkpoint
    6. YOUTUBE_UPLOAD    → upload.queue → mark checkpoint
    7. ANALYTICS_SYNC    → analytics.queue → mark checkpoint

  Resume logic:
    On startup, query Pipeline where status = 'running' or 'failed'
    Resume from last FAILED checkpoint
    Skip COMPLETED checkpoints
  ```
- Remove `FlowProducer` entirely. Each step is a standard BullMQ job.
- Verify: Pipeline survives crash. Resumes from last checkpoint. No wasted recompute.

**Step 12: Circuit Breakers** (Week 8)
- Files: NEW `services/circuit-breaker.service.ts`
- Implementation using `opossum`:
  ```typescript
  const youtubeBreaker = new CircuitBreaker(uploadToYouTube, {
    timeout: 120000,
    errorThresholdPercentage: 50,   // open after 50% failures
    resetTimeout: 300000,           // try again after 5 min
    volumeThreshold: 3,             // need 3 requests to calculate
  });
  ```
- Breakers for: YouTube API, AI/LLM calls, FFmpeg render, Google OAuth
- Each breaker logs state changes and emits metrics
- Fallback: return cached/default data when breaker is open
- Verify: After 3 consecutive upload failures, breaker opens. Uploads queued but not executed until breaker resets.

**Step 13: Prometheus Metrics** (Week 8)
- Files: `server.ts` (MODIFY), NEW `services/metrics.service.ts`
- Add `prom-client` library. Export:
  ```
  youtube_uploads_total{status,channel} counter
  youtube_quota_remaining gauge
  queue_depth{queue_name} gauge
  worker_active_jobs{worker_name} gauge
  render_duration_seconds histogram
  pipeline_step_duration_seconds histogram
  circuit_breaker_state{name} gauge (0=closed,1=open,2=half-open)
  ```
- `GET /api/metrics` returns Prometheus-formatted text
- Verify: Prometheus can scrape all metrics. Grafana dashboard possible.

**Step 14: FFmpeg Cross-Platform Fonts** (Week 9)
- Files: `services/render.service.ts` (MODIFY), `services/auto-pipeline-orchestrator.ts` (MODIFY)
- Action:
  - Add font detection: check multiple OS paths, fall back to bundled `NotoSans-Regular.ttf`
  - Bundle Roboto/Noto Sans in `api/assets/fonts/`
  - Create `resolveFontPath()`: Windows → `C:\Windows\Fonts\arial.ttf`, Linux → `/usr/share/fonts/...`, Docker → bundled
- Verify: Render works on Windows, Linux, Docker without code changes.

**Step 15: Unified Startup** (Week 9)
- Files: ALL startup scripts except `start-all.js` (DEPRECATE/DELETE)
- Actions:
  - Document `start-all.js` as the ONLY supported startup path
  - Deprecate: `start-dev.ps1`, `dev-orchestrator.js`, `guardian.ps1`, `pm2:*` scripts
  - Keep PM2 for production process management only
- Verify: One command (`npm start` or `npm run start:all`) runs everything consistently.

---

## 3. New Target Architecture

### 3.1 Queue System Design

```
┌─────────────────────────────────────────────────────────────────┐
│                        BULLMQ (Redis 7)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Pipeline Queues (7):                                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────────┐  │
│  │ trend    │ │ script   │ │ agent    │ │ render             │  │
│  │ analysis │ │generation│ │ tasks    │ │ (concurrency: 3)   │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────────┘  │
│                    ↓                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                        │
│  │ output   │ │youtube   │ │analytics │                        │
│  │validation│ │upload    │ │sync      │                        │
│  └──────────┘ └──────────┘ └──────────┘                        │
│                                                                  │
│  Income Queues (8 — REPLACES InMemoryQueue):                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ income-  │ │ income-  │ │ income-  │ │ income-  │          │
│  │ topic    │ │ content  │ │monetizati│ │ upload   │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ income-  │ │ income-  │ │ income-  │ │ income-  │          │
│  │ analytics│ │ learning │ │ risk     │ │ cycle    │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│                                                                  │
│  Dead-Letter Queues (one per queue, auto-forward):              │
│  • Jobs that exhausted retries → moved to DLQ                   │
│  • DLQ visible in QueueMonitor dashboard                         │
│  • Recovery: move DLQ job back to source queue                   │
└─────────────────────────────────────────────────────────────────┘

Queue Configuration (all queues):
  | Setting          | Value           |
  |------------------|-----------------|
  | attempts        | 3-5              |
  | backoff         | exponential 2-10s|
  | removeOnComplete| 48h, count: 1000 |
  | removeOnFail    | 7d, count: 500   |
  | stalledInterval | 30s (fast detect)|
  | lockDuration    | 300s             |
```

### 3.2 Worker Model

```
┌─────────────────────────────────────────────────────────────────┐
│                        WORKER ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Instance 1 (API + Workers)                              │    │
│  │  ┌────────────────┐  ┌────────────────────┐             │    │
│  │  │ Express Server  │  │ BullMQ Workers      │             │    │
│  │  │ port 4000       │  │  • render (conc 3) │             │    │
│  │  │                 │  │  • upload (conc 2) │             │    │
│  │  │ API Routes      │  │  • script  (conc 2)│             │    │
│  │  │ 140+ endpoints  │  │  • agent   (conc 3)│             │    │
│  │  │                 │  │  • income  (conc 2)|             │    │
│  │  │ Metrics/Health  │  │  • cleanup (conc 1)│             │    │
│  │  └────────────────┘  └────────────────────┘             │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Instance 2+ (Worker-Only — horizontal scale)            │    │
│  │  ┌────────────────────┐  ┌────────────────────┐         │    │
│  │  │ BullMQ Workers      │  │ No Express server  │         │    │
│  │  │  • render (conc 5)  │  │                    │         │    │
│  │  │  • upload (conc 3)  │  │ Connects to same   │         │    │
│  │  │  • agent  (conc 5)  │  │ Redis + Postgres   │         │    │
│  │  └────────────────────┘  └────────────────────┘         │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  GPU Detection:                                                   │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ detectGpuEncoder():                                           ││
│  │   1. Run `ffmpeg -encoders | findstr nvenc`                  ││
│  │   2. If nvenc found → use h264_nvenc (preset p4, cq 23)     ││
│  │   3. If not → check QSV, AMF                                 ││
│  │   4. Fallback → libx264 ultrafast                            ││
│  │   5. Cache result in Redis (key: `system:gpu-encoder`)      ││
│  └──────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 Upload Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   UPLOAD PIPELINE (CHECKPOINT-BASED)             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  STEP 1: TREND_ANALYSIS                                         │
│  Job → trend-analysis queue → trend.worker.ts                    │
│  On success: mark checkpoint COMPLETED in DB                     │
│  On failure: retry 3x, then → DLQ                                │
│                                                                  │
│  STEP 2: SCRIPT_GENERATION                                       │
│  Job → script-generation queue → script.worker.ts                │
│  On success: mark checkpoint COMPLETED in DB                     │
│  On failure: retry 3x, then → DLQ                                │
│                                                                  │
│  STEP 3: AGENT_DISPATCH (4 sub-tasks)                            │
│  Jobs → agent-tasks queue → agent.worker.ts                      │
│  Each sub-task (prompt, voiceover, thumb, seo) tracked           │
│  independently in Pipeline checkpoint table                      │
│                                                                  │
│  STEP 4: VIDEO_RENDER                                            │
│  Job → video-render queue → render.worker.ts (concurrency: 3)   │
│  GPU auto-detected (NVENC > QSV > x264)                          │
│  3 retry attempts per scene, fallback to color+text              │
│  ffprobe validation after render                                 │
│                                                                  │
│  STEP 5: OUTPUT_VALIDATION                                       │
│  Inline in render.worker.ts (no separate queue needed)           │
│  Checks: file exists, size > 2KB, video stream, duration > 3s   │
│                                                                  │
│  STEP 6: YOUTUBE_UPLOAD                                          │
│  Job → youtube-upload queue → upload.worker.ts                   │
│  QUOTA CHECK: QuotaManager.preCheck() → BLOCK if < 2000         │
│  RATE CHECK: ChannelLimiter.check() → BLOCK if > 2/hr           │
│  TOKEN REFRESH: getAuthenticatedClient() → auto-refresh         │
│  UPLOAD: youtube.videos.insert with resumable media             │
│  On success: QuotaManager.recordUsage(1605)                      │
│  On auth fail: activateFallback, re-queue for retry             │
│                                                                  │
│  STEP 7: ANALYTICS_SYNC                                          │
│  Job → analytics-collection queue → analytics.worker.ts          │
│  Fetch YouTube Analytics API for video stats                     │
│  Update ContentPerformance + RevenueTracker estimates            │
│  Update ViralLearningLoop patterns                               │
│                                                                  │
│  FAILURE RECOVERY:                                                │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ On restart: query Pipeline where status = 'running'          │ │
│  │ Resume from last FAILED checkpoint                           │ │
│  │ Skip COMPLETED checkpoints                                   │ │
│  │ Max retries per step: 3                                      │ │
│  │ After max retries → DLQ, notify admin                        │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 DB Model Changes

```prisma
// NEW: Pipeline checkpoint tracking
model PipelineCheckpoint {
  id            String   @id @default(cuid())
  projectId     String
  step          String   // TREND_ANALYSIS | SCRIPT_GENERATION | AGENT_DISPATCH | VIDEO_RENDER | OUTPUT_VALIDATION | YOUTUBE_UPLOAD | ANALYTICS_SYNC
  status        String   // PENDING | RUNNING | COMPLETED | FAILED | SKIPPED
  retryCount    Int      @default(0)
  maxRetries    Int      @default(3)
  error         String?
  checkpointData Json?   // Step-specific state (e.g., render output path, video ID)
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  project VideoProject @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, step])
  @@index([status])
}

// NEW: YouTube API quota tracking
model YouTubeQuotaUsage {
  id        String   @id @default(cuid())
  channelId String
  date      DateTime // Date only (normalized to UTC midnight)
  unitsUsed Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([channelId, date])
  @@index([channelId, date])
}

// NEW: Worker heartbeat (for dead worker detection)
model WorkerHeartbeat {
  id        String   @id @default(cuid())
  name      String   // worker name (e.g., "render-worker-1")
  queue     String   // queue name (e.g., "video-render")
  hostname  String
  pid       Int
  status    String   // ALIVE | STALLED | DEAD
  lastBeat  DateTime
  createdAt DateTime @default(now())

  @@index([name])
  @@index([status])
}

// MODIFIED: Increase usage tracking on User for rate limiting
model User {
  // ... existing fields ...
  dailyUploadLimit Int @default(10) // Max uploads per day across all channels
}

// MODIFIED: Add quota tracking fields to YouTubeAccount
model YouTubeAccount {
  // ... existing fields ...
  dailyQuotaUsed  Int  @default(0)
  quotaResetAt    DateTime? // When daily quota resets (UTC midnight)
  hourlyUploads   Int  @default(0) // Uploads in current hour
  hourlyResetAt   DateTime? // When hourly counter resets
}
```

### 3.5 Express + Middleware Stack (New Order)

```
1. helmet()                          ← Security headers
2. cors()                            ← CORS whitelist
3. requestId()                       ← X-Request-Id (earlier for logging)
4. express.json({ limit: '5mb' })    ← Body parser
5. express.urlencoded()
6. morgan()                          ← HTTP request logging (structured JSON)
7. connectTimeout(120000)            ← REQUEST TIMEOUT (NEW)
8. redisRateLimiter                  ← Global rate limiter
9. channelRateLimit                  ← Per-channel rate limit (NEW)
10. securityHeaders                  ← nosniff, frame, xss, hsts
11. storageGuard                     ← Disk space check
12. routes                           ← All API routes
13. errorHandler                     ← Includes timeout error handling
14. metrics                          ← GET /api/metrics (Prometheus)
```

---

## 4. Code Patch Strategy

### 4.1 Files to DELETE

| File | Reason |
|------|--------|
| `api/src/services/income-system-v2/in-memory-queue.ts` | Replaced by BullMQ |
| `api/src/services/income-system-v2/income.queue.ts` | Rewritten to BullMQ |
| `api/src/services/income-system-v2/income.workers.ts` | Rewritten to BullMQ Worker |
| `api/src/queues/pipeline.queue.ts` | FlowProducer removed |
| `api/src/services/income-system-v2/types.ts` (queue names only) | Moved to shared types |
| `scripts/start-dev.ps1` | Deprecated — use start-all.js only |
| `scripts/dev-orchestrator.js` | Deprecated |
| `scripts/guardian.ps1` | Deprecated |

### 4.2 Files to REWRITE (Complete)

| File | What Changes |
|------|-------------|
| `api/src/queues/video.queue.ts` | Remove Proxy pattern → eager Queue singletons. Remove FlowProducer. Add DLQ auto-forward config. |
| `api/src/services/render.service.ts` | GPU detection. Font path resolver. Cross-platform paths. Concurrency-safe temp dirs. |
| `api/src/workers/render.worker.ts` | concurrency: 3. GPU encoder selection. Per-job staging dir. Staged cleanup. |
| `api/src/workers/upload.worker.ts` | QuotaManager.preCheck() before upload. ChannelLimiter.check(). Metrics recording. Breaker integration. |
| `api/src/utils/logger.ts` | Replace with pino. Structured JSON. reqId support. Worker ID injection. |
| `scripts/start-all.js` | Remove blocking upload. Remove 3-stage retry. Fire-and-forget health. Fire-and-forget upload job. |
| `api/src/server.ts` | Add connect-timeout. Add channelRateLimit middleware. Add Prometheus metrics route. Update middleware order. |

### 4.3 Files to MODIFY (Targeted Changes)

| File | Change |
|------|--------|
| `api/src/config/db.ts` | `connection_limit: 25` in DATABASE_URL. Add `DATABASE_POOL_URL` for PgBouncer. |
| `api/src/config/redis.ts` | Increase `maxRetriesPerRequest: null` (BullMQ requirement). Add Redis health check endpoint. |
| `api/src/services/youtube.service.ts` | Call `QuotaManager.recordUsage()` after upload. Call `ChannelLimiter.recordUpload()`. Integrate circuit breaker. |
| `api/src/services/youtube-oauth.service.ts` | Add background token refresh scheduler (refresh tokens before they expire, not on-demand). |
| `api/src/services/scheduler.service.ts` | Add daily quota reset cron. Add circuit breaker health check cron. |
| `api/src/controllers/youtube-auth.controller.ts` | Add quota status to channel response. |
| `api/src/routes/upload.routes.ts` | Add `channelRateLimit` middleware to upload routes. |
| `api/src/pipeline/pipeline-orchestrator.service.ts` | Rewrite to checkpoint-based. Remove FlowProducer. |
| `api/src/pipeline/steps/*.ts` | Each step emits checkpoint update. Returns checkpointData for resume. |
| `api/src/middleware/errorHandler.ts` | Handle timeout errors (503). Handle rate limit errors (429). |
| `api/src/controllers/upload.controller.ts` | Return queue position + checkpoint progress in response. |
| `api/src/services/auto-pipeline-orchestrator.service.ts` | Use checkpoint pipeline instead of inline steps. |
| `docker/docker-compose.local.yml` | Add PgBouncer service. Add Redis health check. |
| `docker/docker-compose.prod.yml` | Add PgBouncer. Add multi-instance API support. |
| `api/src/services/multi-channel-rotator.service.ts` | Add quota-weighted selection (prefer channels with more remaining quota). |

### 4.4 NEW Files to Create

| File | Purpose |
|------|---------|
| `api/src/services/quota-manager.service.ts` | Daily YouTube quota tracking. Pre-flight check. Circuit breaker. |
| `api/src/services/channel-limiter.service.ts` | Per-channel hourly/daily rate limiting. Redis INCR-based. |
| `api/src/services/circuit-breaker.service.ts` | Opossum-based circuit breaker factory. YouTube, AI, FFmpeg instances. |
| `api/src/services/metrics.service.ts` | Prometheus metric definitions. Counter, gauge, histogram registration. |
| `api/src/services/checkpoint.service.ts` | Pipeline checkpoint CRUD. Resume logic. Status queries. |
| `api/src/middleware/channelRateLimit.ts` | Express middleware that calls ChannelLimiter. Returns 429 with Retry-After. |
| `api/src/middleware/requestTimeout.ts` | connect-timeout wrapper with proper cleanup. Logs timeout with reqId. |
| `api/src/services/income-system-v2/income.queues.ts` | BullMQ queue definitions for income system (replaces old income.queue.ts). |
| `api/src/services/income-system-v2/income.workers-bullmq.ts` | BullMQ Worker for income system (replaces old income.workers.ts). |
| `api/src/services/income-system-v2/index.ts` (REWRITE) | Export new BullMQ-based income queues + workers. |
| `api/src/config/font-resolver.ts` | Cross-platform font path resolution. Bundled fallback font. |
| `api/assets/fonts/NotoSans-Regular.ttf` | Bundled fallback font for non-Windows systems. |
| `api/src/scripts/reset-quota.ts` | Admin script to reset daily quota counters (for testing). |
| `api/prisma/migrations/XXXX_add_pipeline_checkpoint` | Migration for PipelineCheckpoint model. |
| `api/prisma/migrations/XXXX_add_quota_tracking` | Migration for YouTubeQuotaUsage model. |
| `api/prisma/migrations/XXXX_add_worker_heartbeat` | Migration for WorkerHeartbeat model. |

### 4.5 Dependency Order for Patching

```
Phase 1 (Foundation):
  logger.ts REWRITE        ← No deps (everything depends on logging)
  server.ts MODIFY          ← Depends on logger
  start-all.js REWRITE      ← No deps (standalone)
  quota-manager.service.ts  ← Depends on redis
  channel-limiter.service.ts← Depends on redis
  income.queues.ts          ← Depends on BullMQ + redis
  video.queue.ts REWRITE    ← Depends on BullMQ + redis
  income.workers-bullmq.ts  ← Depends on income.queues
  circuit-breaker.service.ts← No deps (standalone utility)

Phase 2 (Scaling):
  db.ts MODIFY              ← Depends on Phase 1
  docker-compose MODIFY     ← Depends on db.ts changes
  font-resolver.ts          ← No deps (standalone)
  render.service.ts REWRITE ← Depends on font-resolver, logger
  render.worker.ts REWRITE  ← Depends on render.service, video.queue
  upload.worker.ts MODIFY   ← Depends on quota-manager, circuit-breaker
  youtube.service.ts MODIFY ← Depends on quota-manager, channel-limiter

Phase 3 (Reliability):
  checkpoint.service.ts     ← Depends on Prisma
  pipeline-orchestrator.ts  ← Depends on checkpoint.service
  auto-pipeline-orchestrator.ts MODIFY ← Depends on pipeline-orchestrator
  metrics.service.ts        ← Depends on logger
  middleware/channelRateLimit.ts ← Depends on channel-limiter
  middleware/requestTimeout.ts ← No deps
  errorHandler.ts MODIFY    ← Depends on requestTimeout
  scheduler.service.ts MODIFY ← Depends on quota-manager
  youtube-oauth.service.ts MODIFY ← Depends on logger
  multi-channel-rotator.service.ts MODIFY ← Depends on quota-manager
  DELETE deprecations       ← Last step, after migration verified
```

---

## 5. Final Production Score Improvement

### Before vs After

```
┌─────────────────────────────────────────────────────────────────────┐
│  SCORE                  BEFORE    AFTER    IMPROVEMENT              │
├─────────────────────────────────────────────────────────────────────┤
│  STABILITY              54/100    89/100    +35 pts                  │
│  SCALABILITY            28/100    78/100    +50 pts                  │
│  MONETIZATION READINESS 22/100    68/100    +46 pts                  │
│  OVERALL                35/100    78/100    +43 pts                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Stability Score Breakdown (54 → 89)

| Factor | Before | After | Why |
|--------|--------|-------|-----|
| Queue persistence | 3/10 | 10/10 | InMemoryQueue → BullMQ |
| Crash recovery | 4/10 | 9/10 | Checkpoint pipeline + DLQ recovery |
| Express stability | 3/10 | 9/10 | Timeout middleware + backpressure |
| OAuth reliability | 8/10 | 9/10 | Background token refresh |
| Error handling | 6/10 | 8/10 | Circuit breakers + structured logging |
| Temp file management | 4/10 | 8/10 | Per-job staging + cleanup guarantee |
| Startup reliability | 2/10 | 10/10 | Non-blocking, never exits |
| Database reliability | 3/10 | 8/10 | PgBouncer + pool scaling |
| Cross-platform | 2/10 | 9/10 | Font resolver + GPU detection |
| **TOTAL** | **54/100** | **89/100** | |

### Scalability Score Breakdown (28 → 78)

| Factor | Before | After | Why |
|--------|--------|-------|-----|
| Render throughput | 2/10 | 7/10 | concurrency 1→3, GPU encoding |
| Queue distribution | 1/10 | 8/10 | InMemoryQueue→BullMQ (multi-worker) |
| DB connection scaling | 2/10 | 8/10 | PgBouncer + pool=25 |
| Horizontal scaling | 1/10 | 7/10 | Worker-only instances possible |
| YouTube quota mgmt | 1/10 | 8/10 | QuotaManager + circuit breaker |
| Channel isolation | 3/10 | 8/10 | Channel-level rate limiting |
| Pipeline parallelism | 2/10 | 8/10 | Checkpoint-based (no chain-kill) |
| Metrics/monitoring | 1/10 | 8/10 | Prometheus endpoint |
| **TOTAL** | **28/100** | **78/100** | |

### Monetization Readiness Breakdown (22 → 68)

| Factor | Before | After | Why |
|--------|--------|-------|-----|
| Upload reliability | 5/10 | 9/10 | Quota-aware, circuit-broken, retry-safe |
| Render quality | 3/10 | 7/10 | GPU encoding, cross-platform fonts |
| Pipeline reliability | 3/10 | 8/10 | Checkpoint resume, no wasted work |
| Revenue tracking | 4/10 | 6/10 | Analytics sync step in pipeline |
| Channel scaling | 2/10 | 7/10 | 10-channel capable, quota-aware |
| Ops monitoring | 1/10 | 8/10 | Metrics, structured logs, DLQ UI |
| **TOTAL** | **22/100** | **68/100** | |

### Target State Verification

```
After all fixes, the system will:

✔ 100% non-blocking startup          start-all.js exits in <10s
✔ 100% queue persistence              All queues via BullMQ + Redis
✔ 100% crash recovery                 Checkpoint pipeline resumes from failure
✔ Multi-channel scaling (10-100)      GPU render farm + quota manager + PgBouncer
✔ Safe YouTube quota usage            QuotaManager blocks before quota exhausted
✔ Stable FFmpeg rendering             GPU auto-detect + 3-retry scene fallback
✔ Zero in-memory critical state       No InMemoryQueue, no Map-based job storage
✔ Production-ready deployment         Windows + Linux + Docker via font resolver
```

---

## Implementation Notes

### Migration Strategy

Do NOT attempt to fix everything at once. Follow the phase order:

1. **Phase 1 (Week 1-3)**: All changes are backward-compatible. Old InMemoryQueue code is side-by-side with new BullMQ code. Workers can run both systems in parallel.
2. **Phase 2 (Week 4-6)**: Performance changes. Render farm requires queue changes from Phase 1. DB changes require migration.
3. **Phase 3 (Week 7-10)**: Reliability changes depend on Phase 1+2 being stable.

### Rollback Plan

Each phase must include:
- Prisma migration rollback command
- Git tag before changes
- Feature flag to fall back to old implementation
- Smoke test suite run before/after

### Testing Requirements

- Unit: Queue serialization/deserialization
- Integration: Pipeline checkpoint resume (kill server mid-pipeline, verify resume)
- E2E: Upload a real video to YouTube (test channel)
- Load: 25 concurrent renders (verify no temp file collisions)
- Chaos: Kill Redis mid-operation (verify BullMQ reconnect)
