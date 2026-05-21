const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const users = await p.user.findMany({ take: 3, select: { id: true, name: true, email: true, role: true } });
  console.log('Users:', JSON.stringify(users, null, 2));
  const accounts = await p.youTubeAccount.findMany({ take: 3 });
  console.log('YouTubeAccounts:', JSON.stringify(accounts, null, 2));
  const projects = await p.videoProject.findMany({ take: 3, orderBy: { createdAt: 'desc' }, select: { id: true, topic: true, status: true } });
  console.log('RecentProjects:', JSON.stringify(projects, null, 2));
  const topics = await p.videoIdea.findMany({ take: 5, orderBy: { createdAt: 'desc' } });
  console.log('VideoIdeas:', JSON.stringify(topics, null, 2));
  const niches = await p.contentStrategy.findMany({ take: 5 });
  console.log('ContentStrategies:', JSON.stringify(niches, null, 2));
  const opps = await p.viralOpportunity.findMany({ take: 5, orderBy: { createdAt: 'desc' } });
  console.log('ViralOpportunities:', JSON.stringify(opps, null, 2));
  await p.$disconnect();
}
main().catch(e => { console.error(e.message); p.$disconnect(); process.exit(1); });
