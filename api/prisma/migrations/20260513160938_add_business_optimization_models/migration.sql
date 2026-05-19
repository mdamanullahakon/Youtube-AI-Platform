-- CreateTable
CREATE TABLE "AIUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "promptLength" INTEGER NOT NULL DEFAULT 0,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WinningPattern" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'hook',
    "niche" TEXT,
    "content" TEXT NOT NULL,
    "patternType" TEXT NOT NULL DEFAULT 'hook-structure',
    "source" TEXT NOT NULL DEFAULT 'transcript-analysis',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sampleSize" INTEGER NOT NULL DEFAULT 1,
    "avgRetention" DOUBLE PRECISION,
    "avgCTR" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "metadata" JSONB,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WinningPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViralOpportunity" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "niche" TEXT,
    "viralScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "saturationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monetizationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retentionProbability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ctrProbability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "competitionLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "audienceSize" TEXT,
    "growthVelocity" TEXT,
    "emerging" BOOLEAN NOT NULL DEFAULT false,
    "lowCompetition" BOOLEAN NOT NULL DEFAULT false,
    "seasonal" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'ai-analysis',
    "metadata" JSONB,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViralOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadSchedule" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "niche" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'daily',
    "uploadDays" TEXT,
    "uploadTime" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "nextScheduledAt" TIMESTAMP(3),
    "lastUploadedAt" TIMESTAMP(3),
    "projectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelMetrics" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscribers" INTEGER NOT NULL DEFAULT 0,
    "totalViews" INTEGER NOT NULL DEFAULT 0,
    "totalVideos" INTEGER NOT NULL DEFAULT 0,
    "estimatedRPM" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedCPM" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedEarnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monthlyViews" INTEGER NOT NULL DEFAULT 0,
    "monthlyWatchHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subscriberGrowth" INTEGER NOT NULL DEFAULT 0,
    "returningViewerPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgCTR" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgRetention" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "topNiche" TEXT,
    "bestUploadTime" TEXT,
    "bestUploadDay" TEXT,
    "metadata" JSONB,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentStrategy" (
    "id" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "channelId" TEXT,
    "userId" TEXT,
    "pacingStyle" TEXT NOT NULL DEFAULT 'fast-paced',
    "hookStyle" TEXT NOT NULL DEFAULT 'curiosity-gap',
    "thumbnailStyle" TEXT NOT NULL DEFAULT 'face-closeup-shock',
    "tone" TEXT NOT NULL DEFAULT 'emotional-curiosity',
    "avgDuration" TEXT NOT NULL DEFAULT '8-10min',
    "uploadFrequency" TEXT NOT NULL DEFAULT 'daily',
    "targetAudience" TEXT,
    "ctaStyle" TEXT NOT NULL DEFAULT 'direct',
    "storytellingArc" TEXT NOT NULL DEFAULT 'problem-solution',
    "colorPalette" TEXT,
    "fontStyle" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ABTestResult" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "testType" TEXT NOT NULL DEFAULT 'title',
    "variantA" TEXT NOT NULL,
    "variantB" TEXT NOT NULL,
    "winner" TEXT,
    "impressionsA" INTEGER NOT NULL DEFAULT 0,
    "impressionsB" INTEGER NOT NULL DEFAULT 0,
    "clicksA" INTEGER NOT NULL DEFAULT 0,
    "clicksB" INTEGER NOT NULL DEFAULT 0,
    "ctrA" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ctrB" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retentionA" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retentionB" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "statisticallySignificant" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'running',
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ABTestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadTimeMetric" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uploadHour" INTEGER NOT NULL,
    "uploadDay" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "avgViews" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgCTR" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgRetention" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tested" BOOLEAN NOT NULL DEFAULT false,
    "lastTestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadTimeMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AIUsage_userId_idx" ON "AIUsage"("userId");

-- CreateIndex
CREATE INDEX "AIUsage_provider_idx" ON "AIUsage"("provider");

-- CreateIndex
CREATE INDEX "AIUsage_createdAt_idx" ON "AIUsage"("createdAt");

-- CreateIndex
CREATE INDEX "AIUsage_userId_createdAt_idx" ON "AIUsage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WinningPattern_category_idx" ON "WinningPattern"("category");

-- CreateIndex
CREATE INDEX "WinningPattern_patternType_idx" ON "WinningPattern"("patternType");

-- CreateIndex
CREATE INDEX "WinningPattern_niche_idx" ON "WinningPattern"("niche");

-- CreateIndex
CREATE INDEX "WinningPattern_score_idx" ON "WinningPattern"("score");

-- CreateIndex
CREATE INDEX "WinningPattern_confidence_idx" ON "WinningPattern"("confidence");

-- CreateIndex
CREATE UNIQUE INDEX "ViralOpportunity_topic_key" ON "ViralOpportunity"("topic");

-- CreateIndex
CREATE INDEX "ViralOpportunity_viralScore_idx" ON "ViralOpportunity"("viralScore");

-- CreateIndex
CREATE INDEX "ViralOpportunity_saturationScore_idx" ON "ViralOpportunity"("saturationScore");

-- CreateIndex
CREATE INDEX "ViralOpportunity_niche_idx" ON "ViralOpportunity"("niche");

-- CreateIndex
CREATE INDEX "ViralOpportunity_emerging_idx" ON "ViralOpportunity"("emerging");

-- CreateIndex
CREATE INDEX "ViralOpportunity_lowCompetition_idx" ON "ViralOpportunity"("lowCompetition");

-- CreateIndex
CREATE INDEX "ViralOpportunity_analyzedAt_idx" ON "ViralOpportunity"("analyzedAt");

-- CreateIndex
CREATE INDEX "UploadSchedule_channelId_idx" ON "UploadSchedule"("channelId");

-- CreateIndex
CREATE INDEX "UploadSchedule_userId_idx" ON "UploadSchedule"("userId");

-- CreateIndex
CREATE INDEX "UploadSchedule_status_idx" ON "UploadSchedule"("status");

-- CreateIndex
CREATE INDEX "UploadSchedule_nextScheduledAt_idx" ON "UploadSchedule"("nextScheduledAt");

-- CreateIndex
CREATE INDEX "ChannelMetrics_channelId_idx" ON "ChannelMetrics"("channelId");

-- CreateIndex
CREATE INDEX "ChannelMetrics_userId_idx" ON "ChannelMetrics"("userId");

-- CreateIndex
CREATE INDEX "ChannelMetrics_collectedAt_idx" ON "ChannelMetrics"("collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentStrategy_niche_key" ON "ContentStrategy"("niche");

-- CreateIndex
CREATE INDEX "ContentStrategy_niche_idx" ON "ContentStrategy"("niche");

-- CreateIndex
CREATE INDEX "ContentStrategy_channelId_idx" ON "ContentStrategy"("channelId");

-- CreateIndex
CREATE INDEX "ABTestResult_projectId_idx" ON "ABTestResult"("projectId");

-- CreateIndex
CREATE INDEX "ABTestResult_testType_idx" ON "ABTestResult"("testType");

-- CreateIndex
CREATE INDEX "ABTestResult_status_idx" ON "ABTestResult"("status");

-- CreateIndex
CREATE INDEX "UploadTimeMetric_channelId_idx" ON "UploadTimeMetric"("channelId");

-- CreateIndex
CREATE INDEX "UploadTimeMetric_score_idx" ON "UploadTimeMetric"("score");

-- CreateIndex
CREATE INDEX "UploadTimeMetric_tested_idx" ON "UploadTimeMetric"("tested");

-- CreateIndex
CREATE INDEX "Analytics_collectedAt_idx" ON "Analytics"("collectedAt");

-- CreateIndex
CREATE INDEX "QueueJob_status_idx" ON "QueueJob"("status");

-- CreateIndex
CREATE INDEX "QueueJob_type_status_idx" ON "QueueJob"("type", "status");

-- CreateIndex
CREATE INDEX "QueueJob_createdAt_idx" ON "QueueJob"("createdAt");

-- CreateIndex
CREATE INDEX "QueueJob_type_createdAt_idx" ON "QueueJob"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Thumbnail_status_idx" ON "Thumbnail"("status");

-- CreateIndex
CREATE INDEX "TrendResearch_topic_idx" ON "TrendResearch"("topic");

-- CreateIndex
CREATE INDEX "UploadHistory_userId_idx" ON "UploadHistory"("userId");

-- CreateIndex
CREATE INDEX "UploadHistory_status_idx" ON "UploadHistory"("status");

-- CreateIndex
CREATE INDEX "UploadHistory_createdAt_idx" ON "UploadHistory"("createdAt");

-- CreateIndex
CREATE INDEX "UploadHistory_userId_createdAt_idx" ON "UploadHistory"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoProject_userId_idx" ON "VideoProject"("userId");

-- CreateIndex
CREATE INDEX "VideoProject_status_idx" ON "VideoProject"("status");

-- CreateIndex
CREATE INDEX "VideoProject_createdAt_idx" ON "VideoProject"("createdAt");

-- CreateIndex
CREATE INDEX "VideoProject_userId_status_idx" ON "VideoProject"("userId", "status");

-- CreateIndex
CREATE INDEX "VideoRender_status_idx" ON "VideoRender"("status");

-- CreateIndex
CREATE INDEX "Voiceover_status_idx" ON "Voiceover"("status");

-- AddForeignKey
ALTER TABLE "AIUsage" ADD CONSTRAINT "AIUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
