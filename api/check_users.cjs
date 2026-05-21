const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const test = p.youtubeAccount || p.youTubeAccount || p._youtubeAccount;
console.log('keys found:', Object.keys(p).filter(k => k.toLowerCase().includes('youtube')));
if (p.youtubeAccount) {
  p.youtubeAccount.findMany({
    include: { user: { select: { id: true, email: true } } }
  }).then(r => {
    console.log(JSON.stringify(r.map(x => ({
      id: x.id,
      userId: x.userId,
      email: x.user?.email,
      channelTitle: x.channelTitle,
      channelId: x.channelId,
      isConnected: x.isConnected,
      hasTokens: !!(x.accessToken && x.refreshToken)
    })), null, 2));
    p.$disconnect();
  }).catch(e => { console.error(e.message); p.$disconnect(); });
} else {
  console.log('no youtubeAccount accessor found');
  p.$disconnect();
}
