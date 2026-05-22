-- AlterTable
ALTER TABLE "VideoProject" ADD COLUMN     "niche" TEXT NOT NULL DEFAULT 'generic';

-- AlterTable
ALTER TABLE "YouTubeAccount" ADD COLUMN     "niche" TEXT NOT NULL DEFAULT 'generic';

-- CreateTable
CREATE TABLE "UploadSlot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeProgress" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "episodeNumber" INTEGER NOT NULL DEFAULT 1,
    "views" INTEGER NOT NULL DEFAULT 0,
    "watchTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retention" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EpisodeProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyPerformance" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "avgCTR" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgRetention" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgWatchTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadSlot_projectId_key" ON "UploadSlot"("projectId");

-- CreateIndex
CREATE INDEX "UploadSlot_projectId_idx" ON "UploadSlot"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeProgress_projectId_key" ON "EpisodeProgress"("projectId");

-- CreateIndex
CREATE INDEX "EpisodeProgress_projectId_idx" ON "EpisodeProgress"("projectId");

-- CreateIndex
CREATE INDEX "WeeklyPerformance_channelId_weekStart_idx" ON "WeeklyPerformance"("channelId", "weekStart");
