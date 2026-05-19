-- CreateTable: TranscriptIntelligence
CREATE TABLE "TranscriptIntelligence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "transcriptText" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "detectedHooks" JSONB,
    "hookScore" DOUBLE PRECISION,
    "hookRecommendations" TEXT[],
    "retentionLoops" JSONB,
    "patternInterrupts" JSONB,
    "storytellingStructure" TEXT,
    "narrativeArcScore" DOUBLE PRECISION,
    "pacingScore" DOUBLE PRECISION,
    "wordsPerSecond" DOUBLE PRECISION,
    "sentenceLengthAvg" DOUBLE PRECISION,
    "pacingPattern" JSONB,
    "engagementScore" DOUBLE PRECISION,
    "viralPotentialScore" DOUBLE PRECISION,
    "detectedCTAs" TEXT[],
    "ctaEffectiveness" DOUBLE PRECISION,
    "emotionalArc" JSONB,
    "insights" JSONB,
    "sourceVideoIds" TEXT[],
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranscriptIntelligence_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ContentInsight
CREATE TABLE "ContentInsight" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "applicationCount" INTEGER NOT NULL DEFAULT 0,
    "lastAppliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptIntelligence_projectId_key" ON "TranscriptIntelligence"("projectId");

-- CreateIndex
CREATE INDEX "ContentInsight_category_idx" ON "ContentInsight"("category");

-- CreateIndex
CREATE INDEX "ContentInsight_confidence_idx" ON "ContentInsight"("confidence");

-- CreateIndex
CREATE INDEX "ContentInsight_source_idx" ON "ContentInsight"("source");

-- AddForeignKey
ALTER TABLE "TranscriptIntelligence" ADD CONSTRAINT "TranscriptIntelligence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "VideoProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
