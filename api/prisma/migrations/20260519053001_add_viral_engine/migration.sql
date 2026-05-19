-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activeChannelId" TEXT;

-- CreateTable
CREATE TABLE "MonetizationConversion" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conversionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonetizationConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonetizationConversionFunnel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "landingPageHtml" TEXT,
    "funnelUrl" TEXT,
    "stages" JSONB,
    "overallConversionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonetizationConversionFunnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortsLongFormLink" (
    "id" TEXT NOT NULL,
    "shortsProjectId" TEXT NOT NULL,
    "shortsVideoId" TEXT NOT NULL,
    "longFormProjectId" TEXT NOT NULL,
    "longFormVideoId" TEXT NOT NULL,
    "shortsTitle" TEXT,
    "longFormTitle" TEXT,
    "linkType" TEXT NOT NULL DEFAULT 'description',
    "trafficDriven" INTEGER NOT NULL DEFAULT 0,
    "conversionsFromTraffic" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShortsLongFormLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeConfig" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "niche" TEXT NOT NULL DEFAULT '',
    "videosPerDay" INTEGER NOT NULL DEFAULT 3,
    "uploadTimes" TEXT NOT NULL DEFAULT '[]',
    "targetAudience" TEXT NOT NULL DEFAULT '',
    "contentStyle" TEXT NOT NULL DEFAULT '',
    "monetizationTypes" TEXT NOT NULL DEFAULT '[]',
    "minCtrThreshold" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "minRetentionThreshold" DOUBLE PRECISION NOT NULL DEFAULT 25.0,
    "maxFailRate" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeTopicCache" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "niche" TEXT NOT NULL DEFAULT '',
    "topic" TEXT NOT NULL,
    "viralScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "competitionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monetizationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ctrPrediction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retentionPrediction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reasoning" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'trending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomeTopicCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeVideoOutput" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "script" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "thumbnailPrompt" TEXT NOT NULL,
    "thumbnailStyle" TEXT NOT NULL,
    "seoTags" TEXT NOT NULL DEFAULT '[]',
    "seoDescription" TEXT NOT NULL DEFAULT '',
    "categoryId" TEXT NOT NULL DEFAULT '',
    "affiliateLinks" TEXT NOT NULL DEFAULT '[]',
    "ctaText" TEXT NOT NULL DEFAULT '',
    "ctaPlacement" TEXT NOT NULL DEFAULT '',
    "funnelType" TEXT NOT NULL DEFAULT '',
    "estimatedCpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uploadStatus" TEXT NOT NULL DEFAULT 'pending',
    "videoId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "error" TEXT,
    "cycleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeVideoOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeAnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "snapshotType" TEXT NOT NULL DEFAULT 'early',
    "minutesSinceUpload" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retention" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "watchTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subscribersGained" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "avgViewDuration" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomeAnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeWinnerPattern" (
    "id" TEXT NOT NULL,
    "patternType" TEXT NOT NULL DEFAULT 'hook-style',
    "patternValue" TEXT NOT NULL,
    "niche" TEXT NOT NULL DEFAULT '',
    "channelId" TEXT,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sampleSize" INTEGER NOT NULL DEFAULT 1,
    "avgViews" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgCtr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgRetention" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeWinnerPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViralPredictionLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "topic" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "trendScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "competitionLevel" TEXT NOT NULL DEFAULT 'medium',
    "searchDemand" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "noveltyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ctrScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retentionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monetizationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "saturationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "viralScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "decision" TEXT NOT NULL DEFAULT 'ALLOW',
    "improvementSuggestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "actualViews" INTEGER NOT NULL DEFAULT 0,
    "actualCTR" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualRetention" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualWatchTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ctrError" DOUBLE PRECISION,
    "retentionError" DOUBLE PRECISION,
    "viralScoreError" DOUBLE PRECISION,
    "weightsUsed" JSONB,
    "metadata" JSONB,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViralPredictionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevenuePredictionLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "topic" TEXT NOT NULL,
    "profitabilityTier" TEXT NOT NULL DEFAULT 'profitable',
    "revenueForecastMin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenueForecastMax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenueForecastExp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "forecastConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "usRevenueMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "adsensePotential" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "affiliatePotential" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalMonetizationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "decision" TEXT NOT NULL DEFAULT 'APPROVE',
    "actualRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualAdsense" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualAffiliate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenueError" DOUBLE PRECISION,
    "weightsUsed" JSONB,
    "metadata" JSONB,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RevenuePredictionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelGrowthSnapshot" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "growthScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgCtr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgRetention" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subscriberGrowth" INTEGER NOT NULL DEFAULT 0,
    "watchTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "consistencyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "channelHealth" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "growthTrend" TEXT NOT NULL DEFAULT 'stable',
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "scalingDecision" TEXT NOT NULL DEFAULT 'STABILIZE',
    "viralRatio" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "evergreenRatio" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "authorityRatio" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "totalVideos" INTEGER NOT NULL DEFAULT 0,
    "totalViews" INTEGER NOT NULL DEFAULT 0,
    "subscribers" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "snapshotDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelGrowthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentMixPlan" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT,
    "viralPct" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "evergreenPct" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "authorityPct" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "viralTopics" JSONB,
    "evergreenTopics" JSONB,
    "authorityTopics" JSONB,
    "forbiddenTopics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "winningNiches" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentMixPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FailedPattern" (
    "id" TEXT NOT NULL,
    "channelId" TEXT,
    "patternType" TEXT NOT NULL DEFAULT 'topic',
    "patternValue" TEXT NOT NULL,
    "niche" TEXT,
    "failureReason" TEXT NOT NULL DEFAULT 'low-ctr',
    "avgScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sampleSize" INTEGER NOT NULL DEFAULT 1,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailedPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyDecision" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decisionType" TEXT NOT NULL DEFAULT 'SCALE',
    "growthScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "reasoning" TEXT NOT NULL DEFAULT '',
    "actions" JSONB,
    "previousScore" DOUBLE PRECISION,
    "scoreDelta" DOUBLE PRECISION,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViralWeightConfig" (
    "id" TEXT NOT NULL,
    "weightType" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "minValue" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "maxValue" DOUBLE PRECISION NOT NULL DEFAULT 0.50,
    "adjustmentRate" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "lastAdjustedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViralWeightConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeCycleLog" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleDate" TEXT NOT NULL,
    "videosPlanned" INTEGER NOT NULL DEFAULT 0,
    "videosUploaded" INTEGER NOT NULL DEFAULT 0,
    "videosFailed" INTEGER NOT NULL DEFAULT 0,
    "totalEstimatedRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "riskFlags" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeCycleLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonetizationConversion_projectId_idx" ON "MonetizationConversion"("projectId");

-- CreateIndex
CREATE INDEX "MonetizationConversion_productId_idx" ON "MonetizationConversion"("productId");

-- CreateIndex
CREATE INDEX "MonetizationConversion_projectId_productId_idx" ON "MonetizationConversion"("projectId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "MonetizationConversionFunnel_projectId_key" ON "MonetizationConversionFunnel"("projectId");

-- CreateIndex
CREATE INDEX "MonetizationConversionFunnel_projectId_idx" ON "MonetizationConversionFunnel"("projectId");

-- CreateIndex
CREATE INDEX "MonetizationConversionFunnel_videoId_idx" ON "MonetizationConversionFunnel"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "ShortsLongFormLink_shortsProjectId_key" ON "ShortsLongFormLink"("shortsProjectId");

-- CreateIndex
CREATE INDEX "ShortsLongFormLink_shortsProjectId_idx" ON "ShortsLongFormLink"("shortsProjectId");

-- CreateIndex
CREATE INDEX "ShortsLongFormLink_longFormProjectId_idx" ON "ShortsLongFormLink"("longFormProjectId");

-- CreateIndex
CREATE INDEX "ShortsLongFormLink_shortsVideoId_idx" ON "ShortsLongFormLink"("shortsVideoId");

-- CreateIndex
CREATE UNIQUE INDEX "IncomeConfig_channelId_key" ON "IncomeConfig"("channelId");

-- CreateIndex
CREATE INDEX "IncomeConfig_channelId_idx" ON "IncomeConfig"("channelId");

-- CreateIndex
CREATE INDEX "IncomeConfig_userId_idx" ON "IncomeConfig"("userId");

-- CreateIndex
CREATE INDEX "IncomeConfig_enabled_idx" ON "IncomeConfig"("enabled");

-- CreateIndex
CREATE INDEX "IncomeTopicCache_channelId_idx" ON "IncomeTopicCache"("channelId");

-- CreateIndex
CREATE INDEX "IncomeTopicCache_niche_idx" ON "IncomeTopicCache"("niche");

-- CreateIndex
CREATE INDEX "IncomeTopicCache_totalScore_idx" ON "IncomeTopicCache"("totalScore");

-- CreateIndex
CREATE INDEX "IncomeTopicCache_expiresAt_idx" ON "IncomeTopicCache"("expiresAt");

-- CreateIndex
CREATE INDEX "IncomeTopicCache_channelId_expiresAt_idx" ON "IncomeTopicCache"("channelId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IncomeVideoOutput_projectId_key" ON "IncomeVideoOutput"("projectId");

-- CreateIndex
CREATE INDEX "IncomeVideoOutput_channelId_idx" ON "IncomeVideoOutput"("channelId");

-- CreateIndex
CREATE INDEX "IncomeVideoOutput_projectId_idx" ON "IncomeVideoOutput"("projectId");

-- CreateIndex
CREATE INDEX "IncomeVideoOutput_uploadStatus_idx" ON "IncomeVideoOutput"("uploadStatus");

-- CreateIndex
CREATE INDEX "IncomeVideoOutput_cycleId_idx" ON "IncomeVideoOutput"("cycleId");

-- CreateIndex
CREATE INDEX "IncomeVideoOutput_channelId_uploadStatus_idx" ON "IncomeVideoOutput"("channelId", "uploadStatus");

-- CreateIndex
CREATE INDEX "IncomeAnalyticsSnapshot_projectId_idx" ON "IncomeAnalyticsSnapshot"("projectId");

-- CreateIndex
CREATE INDEX "IncomeAnalyticsSnapshot_channelId_idx" ON "IncomeAnalyticsSnapshot"("channelId");

-- CreateIndex
CREATE INDEX "IncomeAnalyticsSnapshot_snapshotType_idx" ON "IncomeAnalyticsSnapshot"("snapshotType");

-- CreateIndex
CREATE INDEX "IncomeAnalyticsSnapshot_collectedAt_idx" ON "IncomeAnalyticsSnapshot"("collectedAt");

-- CreateIndex
CREATE INDEX "IncomeAnalyticsSnapshot_projectId_snapshotType_idx" ON "IncomeAnalyticsSnapshot"("projectId", "snapshotType");

-- CreateIndex
CREATE INDEX "IncomeWinnerPattern_patternType_idx" ON "IncomeWinnerPattern"("patternType");

-- CreateIndex
CREATE INDEX "IncomeWinnerPattern_niche_idx" ON "IncomeWinnerPattern"("niche");

-- CreateIndex
CREATE INDEX "IncomeWinnerPattern_score_idx" ON "IncomeWinnerPattern"("score");

-- CreateIndex
CREATE INDEX "IncomeWinnerPattern_channelId_idx" ON "IncomeWinnerPattern"("channelId");

-- CreateIndex
CREATE INDEX "IncomeWinnerPattern_niche_patternType_idx" ON "IncomeWinnerPattern"("niche", "patternType");

-- CreateIndex
CREATE INDEX "ViralPredictionLog_topic_idx" ON "ViralPredictionLog"("topic");

-- CreateIndex
CREATE INDEX "ViralPredictionLog_category_idx" ON "ViralPredictionLog"("category");

-- CreateIndex
CREATE INDEX "ViralPredictionLog_viralScore_idx" ON "ViralPredictionLog"("viralScore");

-- CreateIndex
CREATE INDEX "ViralPredictionLog_decision_idx" ON "ViralPredictionLog"("decision");

-- CreateIndex
CREATE INDEX "ViralPredictionLog_analyzedAt_idx" ON "ViralPredictionLog"("analyzedAt");

-- CreateIndex
CREATE INDEX "ViralPredictionLog_projectId_idx" ON "ViralPredictionLog"("projectId");

-- CreateIndex
CREATE INDEX "ViralPredictionLog_createdAt_idx" ON "ViralPredictionLog"("createdAt");

-- CreateIndex
CREATE INDEX "RevenuePredictionLog_topic_idx" ON "RevenuePredictionLog"("topic");

-- CreateIndex
CREATE INDEX "RevenuePredictionLog_profitabilityTier_idx" ON "RevenuePredictionLog"("profitabilityTier");

-- CreateIndex
CREATE INDEX "RevenuePredictionLog_totalMonetizationScore_idx" ON "RevenuePredictionLog"("totalMonetizationScore");

-- CreateIndex
CREATE INDEX "RevenuePredictionLog_projectId_idx" ON "RevenuePredictionLog"("projectId");

-- CreateIndex
CREATE INDEX "RevenuePredictionLog_createdAt_idx" ON "RevenuePredictionLog"("createdAt");

-- CreateIndex
CREATE INDEX "ChannelGrowthSnapshot_channelId_idx" ON "ChannelGrowthSnapshot"("channelId");

-- CreateIndex
CREATE INDEX "ChannelGrowthSnapshot_snapshotDate_idx" ON "ChannelGrowthSnapshot"("snapshotDate");

-- CreateIndex
CREATE INDEX "ChannelGrowthSnapshot_growthScore_idx" ON "ChannelGrowthSnapshot"("growthScore");

-- CreateIndex
CREATE INDEX "ChannelGrowthSnapshot_channelId_snapshotDate_idx" ON "ChannelGrowthSnapshot"("channelId", "snapshotDate");

-- CreateIndex
CREATE INDEX "ContentMixPlan_channelId_idx" ON "ContentMixPlan"("channelId");

-- CreateIndex
CREATE INDEX "ContentMixPlan_active_idx" ON "ContentMixPlan"("active");

-- CreateIndex
CREATE INDEX "ContentMixPlan_channelId_active_idx" ON "ContentMixPlan"("channelId", "active");

-- CreateIndex
CREATE INDEX "FailedPattern_patternType_idx" ON "FailedPattern"("patternType");

-- CreateIndex
CREATE INDEX "FailedPattern_patternValue_idx" ON "FailedPattern"("patternValue");

-- CreateIndex
CREATE INDEX "FailedPattern_channelId_idx" ON "FailedPattern"("channelId");

-- CreateIndex
CREATE INDEX "FailedPattern_niche_patternType_idx" ON "FailedPattern"("niche", "patternType");

-- CreateIndex
CREATE INDEX "StrategyDecision_channelId_idx" ON "StrategyDecision"("channelId");

-- CreateIndex
CREATE INDEX "StrategyDecision_decisionType_idx" ON "StrategyDecision"("decisionType");

-- CreateIndex
CREATE INDEX "StrategyDecision_decidedAt_idx" ON "StrategyDecision"("decidedAt");

-- CreateIndex
CREATE INDEX "StrategyDecision_channelId_decidedAt_idx" ON "StrategyDecision"("channelId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ViralWeightConfig_weightType_key" ON "ViralWeightConfig"("weightType");

-- CreateIndex
CREATE INDEX "ViralWeightConfig_weightType_idx" ON "ViralWeightConfig"("weightType");

-- CreateIndex
CREATE INDEX "IncomeCycleLog_channelId_idx" ON "IncomeCycleLog"("channelId");

-- CreateIndex
CREATE INDEX "IncomeCycleLog_cycleDate_idx" ON "IncomeCycleLog"("cycleDate");

-- CreateIndex
CREATE INDEX "IncomeCycleLog_status_idx" ON "IncomeCycleLog"("status");

-- CreateIndex
CREATE INDEX "IncomeCycleLog_channelId_cycleDate_idx" ON "IncomeCycleLog"("channelId", "cycleDate");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeChannelId_fkey" FOREIGN KEY ("activeChannelId") REFERENCES "YouTubeAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonetizationConversion" ADD CONSTRAINT "MonetizationConversion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonetizationConversionFunnel" ADD CONSTRAINT "MonetizationConversionFunnel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortsLongFormLink" ADD CONSTRAINT "ShortsLongFormLink_shortsProjectId_fkey" FOREIGN KEY ("shortsProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortsLongFormLink" ADD CONSTRAINT "ShortsLongFormLink_longFormProjectId_fkey" FOREIGN KEY ("longFormProjectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
