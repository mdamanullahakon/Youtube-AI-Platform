import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try {
  const users = await p.user.findMany({ take: 5, select: { id: true, name: true, email: true, role: true } });
  console.log('Users:', JSON.stringify(users, null, 2));
  const accounts = await p.youTubeAccount.findMany({ take: 5 });
  console.log('YouTubeAccounts:', JSON.stringify(accounts, null, 2));
  const configs = await p.appConfig.findMany({ take: 10 });
  console.log('AppConfigs:', JSON.stringify(configs, null, 2));
  const channels = await p.channelMetrics.findMany({ take: 5 });
  console.log('ChannelMetrics:', JSON.stringify(channels, null, 2));
  const projects = await p.videoProject.findMany({ take: 5, orderBy: { createdAt: 'desc' }, select: { id: true, topic: true, status: true } });
  console.log('RecentProjects:', JSON.stringify(projects, null, 2));
  const niches = await p.contentStrategy.findMany({ take: 5 });
  console.log('ContentStrategies:', JSON.stringify(niches, null, 2));
} catch(e) { console.error(e); } finally { await p.$disconnect(); }
