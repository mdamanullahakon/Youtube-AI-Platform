const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const project = await p.videoProject.findUnique({
    where: { id: 'cmpd3whi4000bw80wvz0zvabs' },
    include: { script: true, voiceover: true, videoRender: true }
  });
  console.log(JSON.stringify(project, (key, val) => {
    if (key === 'script' && val) return { id: val.id, content: val.content?.substring(0, 200) };
    return val;
  }, 2));
  await p.$disconnect();
}
main().catch(e => { console.error(e); p.$disconnect(); });
