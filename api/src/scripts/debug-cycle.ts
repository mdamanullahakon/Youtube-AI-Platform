import { prisma } from '../config/db';
(async () => {
  const c = await prisma.incomeCycleLog.findFirst({ orderBy: { cycleDate: 'desc' } });
  console.log('cycleDate:', c?.cycleDate, typeof c?.cycleDate, c?.cycleDate?.constructor?.name);
  console.log('cycleId from outputs:');
  const outs = await prisma.incomeVideoOutput.findMany({ where: { channelId: 'UCUuOLmBZZzVVkjPGB2Tu8Pg' }, select: { cycleId: true, projectId: true, title: true } });
  for (const o of outs) console.log(' ', o.cycleId, o.projectId, o.title?.substring(0, 40));
  await prisma.$disconnect();
})().catch(e => console.error(e.message));
