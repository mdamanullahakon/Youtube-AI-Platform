import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import '../config/redis';
import { uploadToYouTube } from '../services/youtube.service';
import { getAuthenticatedClient } from '../services/youtube-oauth.service';
import { prisma } from '../config/db';

const USER_ID = 'cmp8nn57b000dw8kcce6tmxrc';
const CHANNEL_ID = 'UCUuOLmBZZzVVkjPGB2Tu8Pg';
const TEST_VIDEO_PATH = path.join(__dirname, '../../test_upload.mp4');

async function main() {
  console.log('=== PHASE 1: REAL YOUTUBE UPLOAD TEST ===\n');

  // Step 1: Verify OAuth
  console.log('Step 1: OAuth verification');
  const client = await getAuthenticatedClient(USER_ID, CHANNEL_ID);
  const token = await client.getAccessToken();
  console.log(`  Token OK: ${token?.token?.substring(0, 30)}...`);
  console.log(`  Scopes: youtube, youtube.upload\n`);

  // Step 2: Generate test video if not exists
  if (!fs.existsSync(TEST_VIDEO_PATH)) {
    console.log('Step 2: Generating test video (5s black screen + tone)');
    execSync(
      `ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d=5 ` +
      `-f lavfi -i anullsrc=r=44100:cl=mono ` +
      `-c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p ` +
      `-c:a aac -shortest "${TEST_VIDEO_PATH}"`,
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const size = fs.statSync(TEST_VIDEO_PATH).size;
    console.log(`  Video created: ${(size / 1024).toFixed(1)} KB\n`);
  } else {
    console.log(`Step 2: Test video exists: ${(fs.statSync(TEST_VIDEO_PATH).size / 1024).toFixed(1)} KB\n`);
  }

  // Step 3: Upload to YouTube
  console.log('Step 3: Uploading to YouTube...');
  try {
    const videoId = await uploadToYouTube({
      title: `AI Test Video ${new Date().toISOString().substring(0, 19)}`,
      description: 'This is a test video from the YouTube AI Platform income system.\n\nGenerated automatically at ' + new Date().toISOString(),
      tags: ['test', 'ai', 'automation', 'youtube-ai-platform'],
      categoryId: '28',  // Science & Technology
      privacyStatus: 'unlisted',
      videoPath: TEST_VIDEO_PATH,
      userId: USER_ID,
      channelId: CHANNEL_ID,
    });
    console.log(`  ✓ UPLOAD SUCCESS!`);
    console.log(`  Video ID: ${videoId}`);
    console.log(`  URL: https://youtube.com/watch?v=${videoId}\n`);

    // Step 4: Store upload record
    console.log('Step 4: Creating UploadHistory record');
    await prisma.uploadHistory.create({
      data: {
        projectId: `test_upload_${Date.now()}`,
        userId: USER_ID,
        channelId: CHANNEL_ID,
        videoId,
        title: 'AI Test Video',
        status: 'completed',
        publishedAt: new Date(),
      },
    });
    console.log('  ✓ UploadHistory stored\n');

    // Step 5: Get analytics
    console.log('Step 5: Fetching video analytics...');
    const { getVideoAnalytics } = await import('../services/youtube.service');
    try {
      // Wait a moment for YouTube to process
      await new Promise(r => setTimeout(r, 3000));
      const stats = await getVideoAnalytics(videoId, USER_ID);
      console.log('  Analytics:', JSON.stringify(stats, null, 2));
    } catch (err: any) {
      console.log('  Analytics not available yet (new upload needs time to process):', err.message);
    }

  } catch (err: any) {
    console.error('  ✗ Upload FAILED:', err.message);
    if (err.response?.data?.error) {
      console.error('  API Error:', JSON.stringify(err.response.data.error, null, 2));
    }
  }

  await (prisma as any).$disconnect();
}

main().catch(async (e) => {
  console.error('FATAL:', e);
  await (prisma as any).$disconnect();
});
