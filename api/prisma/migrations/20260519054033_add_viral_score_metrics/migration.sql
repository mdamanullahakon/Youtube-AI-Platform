-- CreateTable
CREATE TABLE "ViralScore" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trendScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "engagementScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retentionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ctrScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monetizationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "noveltyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "competitionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "saturationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "factors" JSONB,
    "recommendations" TEXT[],
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViralScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViralMetrics" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'daily',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3),
    "totalVideos" INTEGER NOT NULL DEFAULT 0,
    "avgViralScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxViralScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "viralRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalViews" INTEGER NOT NULL DEFAULT 0,
    "avgCTR" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgRetention" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "topPerformerId" TEXT,
    "topPerformerScore" DOUBLE PRECISION,
    "metadata" JSONB,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViralMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ViralScore_projectId_key" ON "ViralScore"("projectId");

-- CreateIndex
CREATE INDEX "ViralScore_projectId_idx" ON "ViralScore"("projectId");

-- CreateIndex
CREATE INDEX "ViralScore_overallScore_idx" ON "ViralScore"("overallScore");

-- CreateIndex
CREATE INDEX "ViralScore_topic_idx" ON "ViralScore"("topic");

-- CreateIndex
CREATE INDEX "ViralScore_scoredAt_idx" ON "ViralScore"("scoredAt");

-- CreateIndex
CREATE INDEX "ViralMetrics_channelId_idx" ON "ViralMetrics"("channelId");

-- CreateIndex
CREATE INDEX "ViralMetrics_period_periodStart_idx" ON "ViralMetrics"("period", "periodStart");

-- CreateIndex
CREATE INDEX "ViralMetrics_avgViralScore_idx" ON "ViralMetrics"("avgViralScore");
