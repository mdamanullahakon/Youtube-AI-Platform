-- AlterTable
ALTER TABLE "UploadHistory" ADD COLUMN     "channelId" TEXT;

-- AlterTable
ALTER TABLE "VideoProject" ADD COLUMN     "channelId" TEXT;

-- CreateIndex
CREATE INDEX "UploadHistory_channelId_idx" ON "UploadHistory"("channelId");

-- CreateIndex
CREATE INDEX "UploadHistory_channelId_createdAt_idx" ON "UploadHistory"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoProject_channelId_idx" ON "VideoProject"("channelId");

-- CreateIndex
CREATE INDEX "VideoProject_channelId_status_idx" ON "VideoProject"("channelId", "status");
