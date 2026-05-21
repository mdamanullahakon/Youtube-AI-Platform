-- CreateTable
CREATE TABLE "PipelineCheckpoint" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "error" TEXT,
    "data" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YouTubeQuotaUsage" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "unitsUsed" INTEGER NOT NULL DEFAULT 0,
    "unitsLimit" INTEGER NOT NULL DEFAULT 10000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YouTubeQuotaUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "jobsProcessed" INTEGER NOT NULL DEFAULT 0,
    "jobsFailed" INTEGER NOT NULL DEFAULT 0,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelUsageStats" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "dailyUploads" INTEGER NOT NULL DEFAULT 0,
    "weeklyUploads" INTEGER NOT NULL DEFAULT 0,
    "monthlyUploads" INTEGER NOT NULL DEFAULT 0,
    "totalUploads" INTEGER NOT NULL DEFAULT 0,
    "lastUploadAt" TIMESTAMP(3),
    "avgViews" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgCtr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgRetention" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenueCurrency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelUsageStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderJobMetrics" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "encoder" TEXT NOT NULL DEFAULT 'libx264',
    "scenes" INTEGER NOT NULL DEFAULT 0,
    "duration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "outputSize" INTEGER NOT NULL DEFAULT 0,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RenderJobMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineCheckpoint_projectId_idx" ON "PipelineCheckpoint"("projectId");

-- CreateIndex
CREATE INDEX "PipelineCheckpoint_status_idx" ON "PipelineCheckpoint"("status");

-- CreateIndex
CREATE INDEX "PipelineCheckpoint_projectId_status_idx" ON "PipelineCheckpoint"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineCheckpoint_projectId_step_key" ON "PipelineCheckpoint"("projectId", "step");

-- CreateIndex
CREATE INDEX "YouTubeQuotaUsage_channelId_idx" ON "YouTubeQuotaUsage"("channelId");

-- CreateIndex
CREATE INDEX "YouTubeQuotaUsage_date_idx" ON "YouTubeQuotaUsage"("date");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeQuotaUsage_channelId_date_key" ON "YouTubeQuotaUsage"("channelId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WorkerHeartbeat_workerId_key" ON "WorkerHeartbeat"("workerId");

-- CreateIndex
CREATE INDEX "WorkerHeartbeat_queue_idx" ON "WorkerHeartbeat"("queue");

-- CreateIndex
CREATE INDEX "WorkerHeartbeat_status_idx" ON "WorkerHeartbeat"("status");

-- CreateIndex
CREATE INDEX "WorkerHeartbeat_lastHeartbeat_idx" ON "WorkerHeartbeat"("lastHeartbeat");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelUsageStats_channelId_key" ON "ChannelUsageStats"("channelId");

-- CreateIndex
CREATE INDEX "ChannelUsageStats_channelId_idx" ON "ChannelUsageStats"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "RenderJobMetrics_projectId_key" ON "RenderJobMetrics"("projectId");

-- CreateIndex
CREATE INDEX "RenderJobMetrics_projectId_idx" ON "RenderJobMetrics"("projectId");

-- CreateIndex
CREATE INDEX "RenderJobMetrics_encoder_idx" ON "RenderJobMetrics"("encoder");

-- CreateIndex
CREATE INDEX "RenderJobMetrics_success_idx" ON "RenderJobMetrics"("success");
