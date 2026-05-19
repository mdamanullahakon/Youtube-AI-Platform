import { prisma } from '../config/db';

async function main() {
  const c = await prisma.incomeConfig.count({ where: { channelId: 'UCUuOLmBZZzVVkjPGB2Tu8Pg' } });
  console.log('IncomeConfig:', c);
  const v = await prisma.incomeVideoOutput.findMany({ where: { channelId: 'UCUuOLmBZZzVVkjPGB2Tu8Pg' }, orderBy: { createdAt: 'desc' } });
  console.log('IncomeVideoOutput:', v.length);
  for (const r of v.slice(0, 5)) console.log(`  "${r.title}" → ${r.videoId} (${r.uploadStatus})`);
  const s = await prisma.incomeAnalyticsSnapshot.count({ where: { channelId: 'UCUuOLmBZZzVVkjPGB2Tu8Pg' } });
  console.log('AnalyticsSnapshots:', s);
  const p = await prisma.incomeWinnerPattern.count({ where: { channelId: 'UCUuOLmBZZzVVkjPGB2Tu8Pg' } });
  console.log('WinnerPatterns:', p);
  const t = await prisma.incomeTopicCache.findMany({ where: { channelId: 'UCUuOLmBZZzVVkjPGB2Tu8Pg' } });
  console.log('TopicCache:', t.length);
  for (const r of t) console.log(`  "${r.topic}" (score: ${r.totalScore})`);
  const l = await prisma.incomeCycleLog.count({ where: { channelId: 'UCUuOLmBZZzVVkjPGB2Tu8Pg' } });
  console.log('CycleLogs:', l);
  const u = await prisma.uploadHistory.findFirst({ where: { videoId: 'x5ynz8M-JO4' } });
  console.log('UploadHistory x5ynz8M-JO4:', u ? u.status : 'not found');
  await (prisma as any).$disconnect();
}
main().catch(console.error);
