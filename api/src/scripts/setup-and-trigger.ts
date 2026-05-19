import '../config/redis';
import { prisma } from '../config/db';
import { incomeCycleQueue, closeAllIncomeQueues } from '../services/income-system-v2/income.queue';
import { IncomeCycleJobData, IncomeChannelConfig } from '../services/income-system-v2/types';

const USER_ID = 'cmp8nn57b000dw8kcce6tmxrc';
const CHANNEL_ID = 'UCUuOLmBZZzVVkjPGB2Tu8Pg';

async function main() {
  console.log('=== SETUP: IncomeConfig + Trigger Cycle ===\n');

  // Step 1: Create/update IncomeConfig
  console.log('Step 1: Creating IncomeConfig for real channel');
  const config = await prisma.incomeConfig.upsert({
    where: { channelId: CHANNEL_ID },
    update: { enabled: true, niche: 'tech', videosPerDay: 1 },
    create: {
      channelId: CHANNEL_ID,
      userId: USER_ID,
      niche: 'tech',
      videosPerDay: 1,  // 1 for testing, increase to 3 later
      uploadTimes: JSON.stringify(['09:00']),
      targetAudience: 'tech enthusiasts, developers, AI curious',
      contentStyle: 'educational, tutorial, listicle',
      monetizationTypes: JSON.stringify(['affiliate', 'sponsorship']),
      minCtrThreshold: 2.0,
      minRetentionThreshold: 25.0,
      maxFailRate: 0.3,
      enabled: true,
    },
  });
  console.log(`  IncomeConfig: ${config.id}, videosPerDay=${config.videosPerDay}, enabled=${config.enabled}\n`);

  // Step 2: Trigger a cycle directly
  console.log('Step 2: Enqueuing income cycle job');
  const jobData: IncomeCycleJobData = {
    channelId: CHANNEL_ID,
    userId: USER_ID,
    niche: 'tech',
    configJson: JSON.stringify({
      channelId: CHANNEL_ID,
      userId: USER_ID,
      niche: 'tech',
      videosPerDay: 1,
      uploadTimes: ['09:00'],
      targetAudience: 'tech enthusiasts, developers, AI curious',
      contentStyle: 'educational, tutorial, listicle',
      monetizationTypes: ['affiliate', 'sponsorship'],
      riskThresholds: { minCtr: 2.0, minRetention: 25.0, maxFailRate: 0.3 },
      enabled: true,
    } satisfies IncomeChannelConfig),
  };

  const job = await incomeCycleQueue.add('daily-cycle', jobData);
  console.log(`  Job enqueued: ${job.id}\n`);

  // Step 3: Check queue state
  console.log('Step 3: Queue stats');
  const counts = await incomeCycleQueue.getJobCounts();
  console.log(`  waiting: ${counts.waiting}, active: ${counts.active}, completed: ${counts.completed}, failed: ${counts.failed}\n`);

  await closeAllIncomeQueues();
  await (prisma as any).$disconnect();
  console.log('Done.');
}

main().catch(async (e) => {
  console.error('FAILED:', e);
  await closeAllIncomeQueues();
  await (prisma as any).$disconnect();
});
