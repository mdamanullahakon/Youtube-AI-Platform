import '../config/redis';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { prisma } from '../config/db';
import { uploadToYouTube, getVideoAnalytics } from '../services/youtube.service';
import { incomeAnalyticsQueue, incomeLearningQueue, closeAllIncomeQueues } from '../services/income-system-v2/income.queue';
import type { IncomeAnalyticsJobData, IncomeLearningJobData } from '../services/income-system-v2/types';

const USER_ID = 'cmp8nn57b000dw8kcce6tmxrc';
const CHANNEL_ID = 'UCUuOLmBZZzVVkjPGB2Tu8Pg';
const CYCLE_DATE = new Date().toISOString().split('T')[0];
const CYCLE_ID = `cycle_${CHANNEL_ID}_${CYCLE_DATE}`;
const TEST_VIDEO_PATH = path.join(__dirname, '../../test_upload.mp4');

const W = console.log;

async function main() {
  W('=== REAL CHANNEL: COMPLETE CYCLE (Phase 1+2) ===\n');

  // Ensure test video exists
  if (!fs.existsSync(TEST_VIDEO_PATH)) {
    W('Generating test video...');
    execSync(`ffmpeg -y -f lavfi -i color=c=black:s=1280x720:d=30 -f lavfi -i anullsrc=r=44100:cl=mono -c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p -c:a aac -shortest "${TEST_VIDEO_PATH}"`, { stdio: 'pipe' });
    W(`Video: ${(fs.statSync(TEST_VIDEO_PATH).size / 1024).toFixed(1)} KB`);
  }

  // Topics (pre-defined to skip slow AI)
  const topics = [
    { topic: 'AI Tools for Productivity in 2026', niche: 'tech' },
    { topic: 'Best Budget Smartphones 2026', niche: 'tech' },
    { topic: 'How to Make Money with AI in 2026', niche: 'tech' },
  ];

  // Content templates (skip AI latency)
  const contentTemplates = [
    { title: 'Top 5 AI Tools That Will Make You More Productive in 2026',
      script: 'In this video, we explore the top 5 AI tools that will boost your productivity in 2026...',
      hook: 'These AI tools will completely change how you work in 2026',
      thumbnailPrompt: 'AI productivity tools futuristic concept',
      thumbnailStyle: 'high-contrast', categoryId: '28',
      seoTags: ['AI', 'productivity', 'tools', '2026', 'tech'],
      seoDescription: 'Discover the top 5 AI tools that will boost your productivity in 2026. From ChatGPT to Midjourney, we cover everything you need.' },
    { title: 'Best Budget Smartphones Under $500 in 2026 — Full Comparison',
      script: 'Looking for the best budget smartphone in 2026? We compare the top 5 options under $500...',
      hook: "Don't buy a new phone until you watch this full comparison",
      thumbnailPrompt: 'Budget smartphones 2026 comparison grid',
      thumbnailStyle: 'comparison-grid', categoryId: '28',
      seoTags: ['smartphone', 'budget', '2026', 'review', 'comparison'],
      seoDescription: 'We compare the best budget smartphones under $500 in 2026. Find out which one is right for you.' },
    { title: 'How to Make Money with AI in 2026 (Real Strategies)',
      script: 'I made over $10,000 using AI tools in 2026. Here are the exact strategies I used...',
      hook: 'I made $10k using AI — and you can too with these strategies',
      thumbnailPrompt: 'Making money with AI futuristic dollar signs',
      thumbnailStyle: 'money-focused', categoryId: '28',
      seoTags: ['AI', 'money', 'income', '2026', 'side hustle'],
      seoDescription: 'Learn how to make money with AI in 2026. Real strategies that actually work for generating income.' },
  ];

  const uploadedVideos: Array<{ videoId: string; title: string; projectId: string }> = [];
  let cycleLogId: string | null = null;

  // Create cycle log first
  const cycleLog = await prisma.incomeCycleLog.create({
    data: { channelId: CHANNEL_ID, userId: USER_ID, cycleDate: CYCLE_DATE, videosPlanned: topics.length, status: 'running' },
  });
  cycleLogId = cycleLog.id;
  W(`Cycle started: ${cycleLog.id}`);

  // Upload each video
  for (let i = 0; i < topics.length; i++) {
    const t = topics[i];
    const ct = contentTemplates[i];
    const projectId = `cycle_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`;

    W(`\n--- Video ${i+1}/${topics.length}: "${ct.title}" ---`);

    try {
      const videoId = await uploadToYouTube({
        title: ct.title,
        description: `${ct.seoDescription}\n\n#AI #Tech #${t.niche}\n\n---\nSubscribe for more content like this!`,
        tags: ct.seoTags,
        categoryId: ct.categoryId || '28',
        privacyStatus: 'unlisted',
        videoPath: TEST_VIDEO_PATH,
        userId: USER_ID,
        channelId: CHANNEL_ID,
      });

      // Store in IncomeVideoOutput
      await prisma.incomeVideoOutput.create({
        data: {
          projectId, channelId: CHANNEL_ID, userId: USER_ID,
          topic: t.topic, title: ct.title, script: ct.script, hook: ct.hook,
          thumbnailPrompt: ct.thumbnailPrompt, thumbnailStyle: ct.thumbnailStyle,
          seoTags: JSON.stringify(ct.seoTags), seoDescription: ct.seoDescription,
          categoryId: ct.categoryId, uploadStatus: 'uploaded', videoId,
          publishedAt: new Date(), cycleId: CYCLE_ID,
          affiliateLinks: JSON.stringify([{ product: 'AI Tool Kit', url: 'https://example.com/ai-tools', placement: 'description' }]),
          ctaText: 'Subscribe for more AI content!',
          ctaPlacement: 'end', funnelType: 'awareness',
          estimatedCpm: 0.50, estimatedRevenue: 0.50,
        },
      });

      uploadedVideos.push({ videoId, title: ct.title, projectId });
      W(`  ✓ UPLOADED: https://youtube.com/watch?v=${videoId}`);

      // Schedule analytics jobs (30min + 12h)
      await incomeAnalyticsQueue.add('collect-early-analytics', {
        projectId, videoId, channelId: CHANNEL_ID, snapshotType: 'early', delayMinutes: 30,
      } satisfies IncomeAnalyticsJobData, { delay: 30 * 60 * 1000 });

      await incomeAnalyticsQueue.add('collect-full-analytics', {
        projectId, videoId, channelId: CHANNEL_ID, snapshotType: 'full', delayMinutes: 720,
      } satisfies IncomeAnalyticsJobData, { delay: 720 * 60 * 1000 });

      W(`  ✓ Analytics scheduled (30min + 12h)`);

    } catch (err: any) {
      W(`  ✗ Failed: ${err.message}`);
    }
  }

  // Update cycle log
  await prisma.incomeCycleLog.update({
    where: { id: cycleLog.id },
    data: {
      status: 'completed', completedAt: new Date(),
      videosPlanned: topics.length,
      videosUploaded: uploadedVideos.length,
      videosFailed: topics.length - uploadedVideos.length,
      totalEstimatedRevenue: uploadedVideos.length * 0.50,
    },
  });
  W(`\nCycle completed: ${uploadedVideos.length}/${topics.length} uploaded`);

  // Schedule learning job
  if (uploadedVideos.length > 0) {
    await incomeLearningQueue.add('detect-winners', {
      channelId: CHANNEL_ID, cycleId: CYCLE_ID, date: CYCLE_DATE,
    } satisfies IncomeLearningJobData, { delay: 35 * 60 * 1000 });
    W('✓ Learning job scheduled (35min delay)');
  }

  // Try fetching analytics for first uploaded video
  if (uploadedVideos.length > 0) {
    const firstVideo = uploadedVideos[0];
    W(`\n--- Analytics check: ${firstVideo.videoId} ---`);
    try {
      await new Promise(r => setTimeout(r, 5000));
      const stats = await getVideoAnalytics(firstVideo.videoId, USER_ID);
      W(`  Views: ${stats?.views}`);
      W(`  Likes: ${stats?.likes}`);
      W(`  CTR: ${stats?.ctr}%`);
      W(`  Retention: ${stats?.retention}%`);
      if (stats) {
        await prisma.incomeAnalyticsSnapshot.create({
          data: {
            projectId: firstVideo.projectId,
            videoId: firstVideo.videoId, channelId: CHANNEL_ID,
            snapshotType: 'early', minutesSinceUpload: 5,
            views: stats.views ?? 0, likes: stats.likes ?? 0,
            comments: stats.comments ?? 0, shares: stats.shares ?? 0,
            ctr: stats.ctr ?? 0, retention: stats.retention ?? 0,
            watchTime: stats.watchTime ?? 0,
            subscribersGained: stats.subscribersGained ?? 0,
            impressions: stats.impressions ?? 0,
            avgViewDuration: stats.avgViewDuration ?? 0,
            collectedAt: new Date(),
          },
        });
        W('  ✓ Analytics snapshot stored in DB');
      }
    } catch (err: any) {
      W(`  Analytics not yet available: ${err.message}`);
    }
  }

  // Summary
  W('\n═══════════════════════════════════════');
  W('  CYCLE COMPLETE');
  W('═══════════════════════════════════════');
  for (const v of uploadedVideos) {
    W(`  https://youtube.com/watch?v=${v.videoId}  ← "${v.title}"`);
  }
  W(`\n  Total uploaded: ${uploadedVideos.length}`);

  await closeAllIncomeQueues();
  await (prisma as any).$disconnect();
}

main().catch(async (e) => {
  W(`FATAL: ${e}`);
  await closeAllIncomeQueues();
  await (prisma as any).$disconnect();
});
