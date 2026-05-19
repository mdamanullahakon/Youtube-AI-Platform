import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const prisma = new PrismaClient();
const connection = new IORedis('redis://localhost:6380', { maxRetriesPerRequest: null });

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('\n========================================');
  console.log('  FULL PIPELINE E2E TEST');
  console.log('========================================\n');

  const user = await prisma.user.findFirst();
  if (!user) { console.error('No user found'); process.exit(1); }
  console.log(`User: ${user.email} (${user.id})`);

  const topic = 'Why the ocean is terrifying';
  const project = await prisma.videoProject.create({
    data: { userId: user.id, topic, status: 'draft' },
  });
  console.log(`\n[1] Project created: ${project.id}`);
  console.log(`    Topic: "${topic}"`);

  const queue = new Queue('video-generation', { connection });
  await queue.add('full-pipeline', { projectId: project.id, topic });
  console.log(`[2] Pipeline job enqueued`);

  const startTime = Date.now();
  let lastStatus = '';

  console.log(`\n[3] Waiting for pipeline...\n`);
  for (let i = 0; i < 120; i++) {
    const p = await prisma.videoProject.findUnique({
      where: { id: project.id },
      include: {
        trendResearch: true,
        script: true,
        thumbnail: true,
        voiceover: true,
        videoRender: true,
        uploadHistory: true,
      },
    });

    const s = p?.status || 'unknown';
    if (s !== lastStatus) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      console.log(`  [${elapsed}s] Status: ${s}`);
      lastStatus = s;
    }

    if (s === 'published' || s === 'uploaded' || s === 'failed') break;
    if (p?.videoRender?.status === 'completed' || p?.uploadHistory?.status === 'uploaded') break;
    await sleep(15000);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const final = await prisma.videoProject.findUnique({
    where: { id: project.id },
    include: {
      trendResearch: true,
      script: true,
      thumbnail: true,
      voiceover: true,
      videoRender: true,
      uploadHistory: true,
    },
  });

  console.log(`\n========================================`);
  console.log(`  PIPELINE RESULT (${elapsed}s)`);
  console.log(`========================================`);
  console.log(`  Status:      ${final?.status}`);
  console.log(`  Script:      ${final?.script ? `YES (${final.script.wordCount} words)` : 'NO'}`);
  console.log(`  Scenes:      ${final?.script?.content ? (final.script.content.match(/\[.*?\]/g)||[]).length : 0}`);
  console.log(`  Thumbnail:   ${final?.thumbnail ? 'YES' : 'NO'}`);
  console.log(`  Voiceover:   ${final?.voiceover ? 'YES' : 'NO'}`);
  console.log(`  Render:      ${final?.videoRender ? `YES (${final.videoRender.status})` : 'NO'}`);
  console.log(`  Upload:      ${final?.uploadHistory ? `YES (${final.uploadHistory.status})` : 'NO'}`);

  const success = final?.uploadHistory || final?.status === 'published' || final?.status === 'uploaded';
  console.log(`\n  VERDICT: ${success ? '✅ PIPELINE COMPLETE' : '❌ PIPELINE INCOMPLETE'}`);

  await queue.close();
  await connection.quit();
  await prisma.$disconnect();
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
