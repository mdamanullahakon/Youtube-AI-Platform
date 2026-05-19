import '../config/redis';
import { prisma } from '../config/db';
import { getVideoAnalytics } from '../services/youtube.service';
import { LearningEngine } from '../services/income-system-v2/learning-engine.service';

const USER_ID = 'cmp8nn57b000dw8kcce6tmxrc';
const CHANNEL_ID = 'UCUuOLmBZZzVVkjPGB2Tu8Pg';
const W = console.log;

async function main() {
  W('=== POST-CYCLE ANALYTICS COLLECTOR ===\n');

  // All videos uploaded so far
  const outputs = await prisma.incomeVideoOutput.findMany({
    where: { channelId: CHANNEL_ID, uploadStatus: 'uploaded' },
    orderBy: { publishedAt: 'desc' },
  });

  W(`Found ${outputs.length} uploaded videos:\n`);

  for (const o of outputs) {
    const age = o.publishedAt ? Math.round((Date.now() - o.publishedAt.getTime()) / 3600000) + 'h ago' : '?';
    W(`  ${o.videoId}  "${o.title}"  (${age})`);

    try {
      if (!o.videoId) continue;
      const stats = await getVideoAnalytics(o.videoId, USER_ID);
      if (stats) {
        W(`    Views: ${stats.views}  Likes: ${stats.likes}  CTR: ${stats.ctr}%  Retention: ${stats.retention}%`);

        // Store snapshot if not exists
        const existing = await prisma.incomeAnalyticsSnapshot.findFirst({
          where: { projectId: o.projectId, snapshotType: 'post-cycle' },
        });
        if (!existing) {
          await prisma.incomeAnalyticsSnapshot.create({
            data: {
              projectId: o.projectId, videoId: o.videoId || '', channelId: CHANNEL_ID,
              snapshotType: 'post-cycle', minutesSinceUpload: 0,
              views: stats.views ?? 0, likes: stats.likes ?? 0,
              comments: stats.comments ?? 0, shares: stats.shares ?? 0,
              ctr: stats.ctr ?? 0, retention: stats.retention ?? 0,
              watchTime: stats.watchTime ?? 0,
              subscribersGained: stats.subscribersGained ?? 0,
              impressions: stats.impressions ?? 0,
              avgViewDuration: stats.avgViewDuration ?? 0,
              collectedAt: new Date(),
            },
          });
          W(`    ✓ Snapshot stored`);
        } else {
          W(`    - Snapshot already exists`);
        }
      } else {
        W(`    No analytics yet`);
      }
    } catch (err: any) {
      W(`    ✗ Error: ${err.message}`);
    }
  }

  // Run learning engine: detect winners
  W('\n=== WINNER DETECTION ===\n');
  const engine = new LearningEngine();
  const cycles = await prisma.incomeCycleLog.findMany({
    where: { channelId: CHANNEL_ID },
    orderBy: { cycleDate: 'desc' },
    take: 5,
  });

  for (const cycle of cycles) {
    if (!cycle.cycleDate) continue;
    const dateStr = String(cycle.cycleDate).split('T')[0];
    const cycleId = `cycle_${CHANNEL_ID}_${dateStr}`;
    W(`Cycle ${dateStr} (${cycleId}):`);
    const winner = await engine.detectBestVideo(CHANNEL_ID, cycleId);
    if (winner) {
      const output = outputs.find(o => o.projectId === (winner as any).projectId);
      W(`  ✓ Winner: ${(winner as any).projectId} → "${output?.title || '?'}" (score: ${(winner as any).score})`);
      await engine.extractPatterns(winner);
      W(`  ✓ Patterns extracted`);
    } else {
      W(`  - No clear winner`);
    }
  }

  // Show patterns
  W('\n=== WINNER PATTERNS ===\n');
  const patterns = await prisma.incomeWinnerPattern.findMany({
    where: { channelId: CHANNEL_ID },
    orderBy: { createdAt: 'desc' },
  });
  W(`Total patterns: ${patterns.length}`);
  for (const p of patterns) {
    W(`  Pattern #${p.id}: type=${p.patternType} score=${p.score} value="${p.patternValue}" sampleSize=${p.sampleSize} confidence=${p.confidence}`);
  }

  // Show analytics snapshots
  W('\n=== ANALYTICS SNAPSHOTS ===\n');
  const snapshots = await prisma.incomeAnalyticsSnapshot.findMany({
    where: { channelId: CHANNEL_ID },
    orderBy: { collectedAt: 'desc' },
    take: 20,
  });
  W(`Total snapshots: ${snapshots.length}`);
  for (const s of snapshots) {
    W(`  ${s.snapshotType} (${s.minutesSinceUpload}min): ${s.videoId} → ${s.views} views, ${s.ctr}% CTR`);
  }

  await (prisma as any).$disconnect();
}

main().catch(e => { W(`FATAL: ${e}`); process.exit(1); });
