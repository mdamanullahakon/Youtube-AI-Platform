-- CreateTable: AnalyticsLearning
CREATE TABLE "AnalyticsLearning" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "hookRetentionScore" DOUBLE PRECISION,
    "hookEffectiveness" JSONB,
    "thumbnailScore" DOUBLE PRECISION,
    "thumbnailStyle" TEXT,
    "dropOffPoints" JSONB,
    "retentionCurve" JSONB,
    "recommendations" JSONB,
    "learningIteration" INTEGER NOT NULL DEFAULT 1,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "lastAnalyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsLearning_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ContentPerformance
CREATE TABLE "ContentPerformance" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "predictedHookScore" DOUBLE PRECISION,
    "predictedThumbnailCTR" DOUBLE PRECISION,
    "predictedRetention" DOUBLE PRECISION,
    "predictedEngagement" DOUBLE PRECISION,
    "actualViews" INTEGER NOT NULL DEFAULT 0,
    "actualCTR" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualRetention" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualWatchTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hookGap" DOUBLE PRECISION,
    "retentionGap" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ThumbnailPerformance
CREATE TABLE "ThumbnailPerformance" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "style" TEXT,
    "prompt" TEXT,
    "predictedCTR" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "actualCTR" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThumbnailPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsLearning_projectId_key" ON "AnalyticsLearning"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPerformance_projectId_key" ON "ContentPerformance"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ThumbnailPerformance_projectId_key" ON "ThumbnailPerformance"("projectId");

-- CreateIndex
CREATE INDEX "ContentPerformance_actualCTR_idx" ON "ContentPerformance"("actualCTR");

-- CreateIndex
CREATE INDEX "ContentPerformance_actualRetention_idx" ON "ContentPerformance"("actualRetention");

-- CreateIndex
CREATE INDEX "ContentPerformance_actualViews_idx" ON "ContentPerformance"("actualViews");

-- CreateIndex
CREATE INDEX "ThumbnailPerformance_style_idx" ON "ThumbnailPerformance"("style");

-- CreateIndex
CREATE INDEX "ThumbnailPerformance_actualCTR_idx" ON "ThumbnailPerformance"("actualCTR");

-- AddForeignKey
ALTER TABLE "AnalyticsLearning" ADD CONSTRAINT "AnalyticsLearning_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPerformance" ADD CONSTRAINT "ContentPerformance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThumbnailPerformance" ADD CONSTRAINT "ThumbnailPerformance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
