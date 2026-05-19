import { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const prisma = new PrismaClient();
const connection = new IORedis('redis://localhost:6380', { maxRetriesPerRequest: null });

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  // Find a user to own the project
  const user = await prisma.user.findFirst();
  if (!user) { console.error('No user found'); process.exit(1); }
  console.log(`Using user: ${user.email} (${user.id})`);

  // Create a project
  const topic = 'Why the ocean is terrifying';
  const project = await prisma.videoProject.create({
    data: { userId: user.id, topic, status: 'draft' },
  });
  console.log(`Created project: ${project.id} (${topic})`);

  // Enqueue full pipeline job
  const videoQueue = new Queue('video-generation', { connection });
  const job = await videoQueue.add('full-pipeline', {
    projectId: project.id,
    topic,
  });
  console.log(`Pipeline job enqueued: ${job.id}`);

  // Poll for completion
  let lastStatus = '';
  for (let i = 0; i < 120; i++) {
    const p = await prisma.videoProject.findUnique({
      where: { id: project.id },
      include: { script: true, videoRender: true, uploadHistory: true },
    });
    const s = p?.status || 'unknown';
    if (s !== lastStatus) {
      console.log(`[${i * 30}s] Status: ${s}`);
      lastStatus = s;
    }
    if (s === 'published' || s === 'failed' || s === 'uploaded') break;
    if (p?.videoRender && p.uploadHistory) break;
    await sleep(30000);
  }

  // Final report
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

  console.log('\n========== PIPELINE RESULT ==========');
  console.log(`Status: ${final?.status}`);
  console.log(`Script: ${final?.script ? 'YES' : 'NO'} (${final?.script?.wordCount || 0} words)`);
  console.log(`Thumbnail: ${final?.thumbnail ? 'YES' : 'NO'}`);
  console.log(`Voiceover: ${final?.voiceover ? 'YES' : 'NO'}`);
  console.log(`Render: ${final?.videoRender ? `YES (${final.videoRender.status})` : 'NO'}`);
  console.log(`Upload: ${final?.uploadHistory ? `YES (${final.uploadHistory.videoId})` : 'NO'}`);

  if (final?.videoRender?.videoUrl) {
    console.log(`Video URL: ${final.videoRender.videoUrl}`);
  }

  // Cleanup
  await videoQueue.close();
  await connection.quit();
  await prisma.$disconnect();
}

main().catch(e => {
  console.error('Pipeline test failed:', e);
  process.exit(1);
});
