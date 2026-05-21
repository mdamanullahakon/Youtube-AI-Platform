const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.videoProject.findUnique({
  where: { id: 'cmpd3whi4000bw80wvz0zvabs' },
  include: { videoRender: true }
}).then(r => {
  console.log(JSON.stringify({
    status: r.status,
    render: r.videoRender ? {
      status: r.videoRender.status,
      videoUrl: r.videoRender.videoUrl,
      progress: r.videoRender.progress
    } : null
  }, null, 2));
  p.$disconnect();
}).catch(e => { console.error(e); p.$disconnect(); });
