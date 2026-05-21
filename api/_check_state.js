const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const proj = await p.videoProject.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { script: true, voiceover: true, thumbnail: true, videoRender: true, uploadHistory: true, analytics: true }
  });
  if (!proj) { console.log('No projects'); return; }
  console.log('Project:', proj.id);
  console.log('Status:', proj.status);
  console.log('Topic:', proj.topic?.substring(0, 80));
  console.log('Script words:', proj.script?.wordCount || 0);
  console.log('Voiceover:', proj.voiceover?.audioUrl || 'NONE');
  console.log('Thumbnail:', proj.thumbnail?.imageUrl || 'NONE');
  console.log('Video:', proj.videoRender?.videoUrl || 'NONE');
  console.log('Upload videoId:', proj.uploadHistory?.videoId || 'NONE');
  console.log('Analytics ID:', proj.analytics?.id || 'NONE');
  const tests = await p.aBTestResult.count({ where: { projectId: proj.id } });
  console.log('AB Tests:', tests);
  await p.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
