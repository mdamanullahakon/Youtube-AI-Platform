-- CreateTable
CREATE TABLE "VideoIdea" (
    "id" TEXT NOT NULL,
    "channelId" TEXT,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "niche" TEXT,
    "topic" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'Shorts',
    "trendScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "viralProbability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "competitionLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "monetizationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ctrPrediction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retentionPrediction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "emotionalAngle" TEXT,
    "hookSuggestion" TEXT,
    "thumbnailDescription" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idea',
    "source" TEXT NOT NULL DEFAULT 'ai-generated',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoIdea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoIdea_niche_idx" ON "VideoIdea"("niche");

-- CreateIndex
CREATE INDEX "VideoIdea_status_idx" ON "VideoIdea"("status");

-- CreateIndex
CREATE INDEX "VideoIdea_trendScore_idx" ON "VideoIdea"("trendScore");

-- CreateIndex
CREATE INDEX "VideoIdea_niche_status_idx" ON "VideoIdea"("niche", "status");
