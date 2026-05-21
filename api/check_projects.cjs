const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.videoProject.findMany({
  where: { status: { in: ['rendered', 'completed'] } },
  include: { videoRender: true },
  orderBy: { updatedAt: 'desc' }
}).then(r => {
  console.log(JSON.stringify(r.map(x => ({
    id: x.id,
    topic: x.topic,
    status: x.status,
    userId: x.userId,
    videoUrl: x.videoRender?.videoUrl
  })), null, 2));
  p.$disconnect();
}).catch(e => { console.error(e); p.$disconnect(); });
