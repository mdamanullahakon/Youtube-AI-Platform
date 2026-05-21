/**
 * Force-render debug script — resets stale render state and triggers re-render.
 * Usage: node force_render.cjs <projectId>
 */
const { PrismaClient } = require('@prisma/client');
const { Queue: BullQueue } = require('bullmq');
const IORedis = require('ioredis');

const projectId = process.argv[2];
if (!projectId) { console.error('Usage: node force_render.cjs <projectId>'); process.exit(1); }

async function main() {
  const prisma = new PrismaClient();

  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: { script: true, voiceover: true, videoRender: true }
  });

  if (!project) { console.error(`Project ${projectId} not found`); process.exit(1); }

  console.log('=== BEFORE ===');
  console.log(`  Status: ${project.status}`);
  console.log(`  Script: ${project.script ? 'yes' : 'no'}`);
  console.log(`  Voiceover: ${project.voiceover ? 'yes' : 'no'}`);
  console.log(`  VideoRender: ${project.videoRender?.status || 'none'}`);

  if (!project.script) { console.error('No script — cannot render'); process.exit(1); }
  if (!project.voiceover) { console.error('No voiceover — cannot render'); process.exit(1); }

  // Reset stale render state
  if (project.videoRender) {
    await prisma.videoRender.delete({ where: { id: project.videoRender.id } });
    console.log('  Deleted stale videoRender record');
  }

  await prisma.videoProject.update({
    where: { id: projectId },
    data: { status: 'voiceover_generated' } // roll back so render can pick it up
  });
  console.log('  Reset project status to voiceover_generated');

  // Enqueue render job
  const redis = new IORedis({ host: 'localhost', port: 6379, maxRetriesPerRequest: null });
  const renderQueue = new BullQueue('video-render', { connection: redis });

  const job = await renderQueue.add('render-video', { projectId });
  console.log(`\nRender job ${job.id} enqueued for project ${projectId}`);
  console.log('Worker will auto-trigger upload on completion');
  console.log(`Poll status: GET /api/videos/status/${projectId}`);

  await renderQueue.close();
  await redis.quit();
  await prisma.$disconnect();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
