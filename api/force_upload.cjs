/**
 * Force-upload debug script — manually triggers YouTube upload for a project.
 * Usage: node force_upload.cjs <projectId>
 */
const { PrismaClient } = require('@prisma/client');
const { Queue: BullQueue } = require('bullmq');
const IORedis = require('ioredis');

const projectId = process.argv[2];
if (!projectId) { console.error('Usage: node force_upload.cjs <projectId>'); process.exit(1); }

async function main() {
  const prisma = new PrismaClient();

  // Find project
  const project = await prisma.videoProject.findUnique({ where: { id: projectId } });
  if (!project) { console.error(`Project ${projectId} not found`); process.exit(1); }

  console.log(`Project: ${project.id}`);
  console.log(`  Status: ${project.status}`);
  console.log(`  Topic: ${project.topic}`);
  console.log(`  ChannelId: ${project.channelId}`);

  // Find the channel owner's YouTube account
  const youtubeAccount = await prisma.youTubeAccount.findFirst({
    where: { channelId: project.channelId, isConnected: true },
  });

  if (!youtubeAccount) {
    // Fallback: find any connected account
    const anyAccount = await prisma.youTubeAccount.findFirst({ where: { isConnected: true } });
    if (anyAccount) {
      console.log(`No account for channel ${project.channelId}, but found other connected account:`);
    } else {
      console.error('No connected YouTube accounts found!');
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  const account = youtubeAccount || await prisma.youTubeAccount.findFirst({ where: { isConnected: true } });
  console.log(`YouTube Account: ${account.id}`);
  console.log(`  Channel: ${account.channelTitle} (${account.channelId})`);
  console.log(`  Has refreshToken: ${!!account.refreshToken}`);

  // Check video file exists
  const fs = require('fs');
  const videoRender = await prisma.videoRender.findFirst({ where: { projectId } });

  if (!videoRender?.videoUrl) {
    console.error('No videoUrl in DB for this project');
    await prisma.$disconnect();
    process.exit(1);
  }

  const videoPath = require('path').join(process.cwd(), videoRender.videoUrl);
  console.log(`Video path: ${videoPath}`);
  console.log(`Video exists: ${fs.existsSync(videoPath)}`);

  if (!fs.existsSync(videoPath)) {
    // The render worker appends timestamp: `projectId_${Date.now()}.mp4`
    // Try to find any file matching the pattern
    const dir = require('path').dirname(videoPath);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.startsWith(projectId)) : [];
    console.log(`Found ${files.length} matching files in ${dir}:`, files);

    if (files.length === 0) {
      console.error('No video file exists on disk. Reset project status to re-render first.');
      console.log('Run: node force_render.cjs ' + projectId);
    }
  }

  // Enqueue upload job
  const redis = new IORedis({ host: 'localhost', port: 6379, maxRetriesPerRequest: null });
  const uploadQueue = new BullQueue('youtube-upload', { connection: redis });

  const job = await uploadQueue.add('upload-video', {
    projectId,
    title: project.title || project.topic,
    description: project.description || '',
    tags: [project.topic],
    privacyStatus: 'public',
  });

  console.log(`\nUpload job ${job.id} enqueued for project ${projectId}`);
  console.log(`Poll status: GET /api/videos/status/${projectId}`);

  await uploadQueue.close();
  await redis.quit();
  await prisma.$disconnect();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
