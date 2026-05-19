import { prisma } from '../config/db';

const CHANNEL_ID = 'UCUuOLmBZZzVVkjPGB2Tu8Pg';
const W = console.log;

async function main() {
  W('=== SYSTEM STATUS ===\n');

  // Videos
  const videos = await prisma.incomeVideoOutput.findMany({
    where: { channelId: CHANNEL_ID },
    orderBy: { publishedAt: 'desc' },
  });
  W(`Videos uploaded: ${videos.length}`);
  for (const v of videos) {
    W(`  https://youtube.com/watch?v=${v.videoId}  "${v.title}"  [${v.uploadStatus}]`);
  }

  // Snapshots
  const snapshots = await prisma.incomeAnalyticsSnapshot.findMany({
    where: { channelId: CHANNEL_ID },
    orderBy: { collectedAt: 'desc' },
  });
  W(`\nAnalytics snapshots: ${snapshots.length}`);
  const byVideo = new Map<string, number>();
  for (const s of snapshots) byVideo.set(s.videoId, (byVideo.get(s.videoId) || 0) + 1);
  for (const [vid, count] of byVideo) W(`  ${vid}: ${count} snapshots`);

  // Patterns
  const patterns = await prisma.incomeWinnerPattern.findMany({
    where: { channelId: CHANNEL_ID },
    orderBy: { createdAt: 'desc' },
  });
  W(`\nWinner patterns: ${patterns.length}`);
  for (const p of patterns) {
    W(`  type=${p.patternType} value="${p.patternValue}" score=${p.score} samples=${p.sampleSize} confidence=${p.confidence}`);
  }

  // Cycles
  const cycles = await prisma.incomeCycleLog.findMany({
    where: { channelId: CHANNEL_ID },
    orderBy: { cycleDate: 'desc' },
  });
  W(`\nCycles: ${cycles.length}`);
  for (const c of cycles) {
    W(`  ${c.cycleDate}: ${c.videosUploaded}/${c.videosPlanned} videos, status=${c.status}`);
  }

  // Topics cached
  const topicCache = await prisma.incomeTopicCache.findMany({
    where: { channelId: CHANNEL_ID },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  W(`\nTopics cached: ${topicCache.length}`);
  for (const t of topicCache) {
    W(`  "${t.topic}" score=${t.totalScore}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { W(`ERR: ${e.message}`); process.exit(1); });
