/*
  Warnings:

  - You are about to drop the column `claudeKey` on the `Settings` table. All the data in the column will be lost.
  - You are about to drop the column `elevenLabsKey` on the `Settings` table. All the data in the column will be lost.
  - You are about to drop the column `openaiKey` on the `Settings` table. All the data in the column will be lost.
  - You are about to drop the column `voiceId` on the `Settings` table. All the data in the column will be lost.
  - You are about to drop the column `voiceId` on the `Voiceover` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Settings" DROP COLUMN "claudeKey",
DROP COLUMN "elevenLabsKey",
DROP COLUMN "openaiKey",
DROP COLUMN "voiceId";

-- AlterTable
ALTER TABLE "Voiceover" DROP COLUMN "voiceId";
