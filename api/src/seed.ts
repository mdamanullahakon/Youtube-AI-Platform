import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const CHANNELS = [
  {
    channelId: 'seed-channel-paranormal',
    name: 'Shadows Unseen',
    niche: 'Horror-Paranormal',
    description: 'Paranormal horror, ghost encounters, haunted locations, supernatural mysteries',
    frequency: 'daily',
    uploadTime: '20:00',
    thumbnailStyle: 'minimalist-mystery',
    colorPalette: 'deep blacks, desaturated grays, single red accent',
    tone: 'whisper-tense',
    pacingStyle: 'slow-burn',
    hookStyle: 'pattern-interrupt',
    ctaStyle: 'fear-of-missing',
    storytellingArc: 'discovery',
    seoKeywords: ['paranormal', 'ghost', 'haunted', 'supernatural', 'unexplained'],
    demoTopics: ['The Whispering Walls of Ward 7', 'I Found a Door in My Basement That Leads Nowhere'],
  },
  {
    channelId: 'seed-channel-psychological',
    name: 'Mind Gap',
    niche: 'Horror-Psychological',
    description: 'Psychological horror, mind-bending stories, reality distortion, existential dread',
    frequency: 'daily',
    uploadTime: '21:00',
    thumbnailStyle: 'face-closeup-shock',
    colorPalette: 'cold blues, sterile whites, deep shadows',
    tone: 'controlled-creepy',
    pacingStyle: 'varied',
    hookStyle: 'provocative-question',
    ctaStyle: 'existential-dread',
    storytellingArc: 'descent',
    seoKeywords: ['psychological', 'mind-bending', 'existential', 'disturbing', 'reality'],
    demoTopics: ['They Told Me The Voices Weren\'t Real — They Lied', 'I Woke Up in Someone Else\'s Body'],
  },
  {
    channelId: 'seed-channel-analog',
    name: 'Archive 87',
    niche: 'Horror-Analog',
    description: 'Analog horror, VHS tapes, emergency broadcasts, archived footage, government coverups',
    frequency: 'every-other-day',
    uploadTime: '22:00',
    thumbnailStyle: 'vhs-static',
    colorPalette: 'vhs scanlines, static white, tape degradation, sepia',
    tone: 'archival-calm',
    pacingStyle: 'slow-burn',
    hookStyle: 'curiosity-gap',
    ctaStyle: 'mystery',
    storytellingArc: 'unraveling',
    seoKeywords: ['analog horror', 'vhs', 'found footage', 'archive', 'broadcast'],
    demoTopics: ['The Emergency Broadcast That Should Never Have Aired', 'Tape #47: The Smiling Man'],
  },
];

async function main() {
  console.log('Seeding database...');

  const systemUser = await prisma.user.upsert({
    where: { email: 'system@youtube-ai-platform.com' },
    update: {},
    create: {
      email: 'system@youtube-ai-platform.com',
      password: await bcrypt.hash('system-seed-only-not-for-login', 12),
      name: 'System',
      role: 'admin',
    },
  });
  console.log(`  System user: ${systemUser.id}`);

  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@youtube-ai-platform.com' },
    update: {},
    create: {
      email: 'demo@youtube-ai-platform.com',
      password: await bcrypt.hash('demo123456', 12),
      name: 'Demo User',
      role: 'user',
      subscription: {
        create: { plan: 'pro', status: 'active', videoLimit: 100, videosUsed: 0 },
      },
    },
  });
  console.log(`  Demo user: ${demoUser.id}`);

  const strategies: { id: string; niche: string }[] = [];

  for (const channel of CHANNELS) {
    const strategy = await prisma.contentStrategy.upsert({
      where: { niche: channel.niche },
      update: {},
      create: {
        niche: channel.niche,
        channelId: channel.channelId,
        userId: systemUser.id,
        pacingStyle: channel.pacingStyle,
        hookStyle: channel.hookStyle,
        thumbnailStyle: channel.thumbnailStyle,
        tone: channel.tone,
        avgDuration: '8-12min',
        uploadFrequency: channel.frequency,
        ctaStyle: channel.ctaStyle,
        storytellingArc: channel.storytellingArc,
        colorPalette: channel.colorPalette,
        metadata: { seoKeywords: channel.seoKeywords, description: channel.description },
      },
    });
    strategies.push({ id: strategy.id, niche: strategy.niche });
    console.log(`  Strategy: ${strategy.niche}`);

    const schedule = await prisma.uploadSchedule.upsert({
      where: { id: `schedule-${channel.channelId}` },
      update: {},
      create: {
        id: `schedule-${channel.channelId}`,
        channelId: channel.channelId,
        userId: systemUser.id,
        niche: channel.niche,
        frequency: channel.frequency,
        uploadTime: channel.uploadTime,
        timezone: 'UTC',
        nextScheduledAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        status: 'active',
        metadata: { name: channel.name, description: channel.description },
      },
    });
    console.log(`  Schedule: ${channel.name} (${channel.frequency} @ ${channel.uploadTime})`);

    for (let i = 0; i < channel.demoTopics.length; i++) {
      const topic = channel.demoTopics[i];
      const project = await prisma.videoProject.create({
        data: {
          userId: systemUser.id,
          channelId: channel.channelId,
          topic,
          title: topic,
          description: `A ${channel.niche.toLowerCase()} horror story.`,
          status: i === 0 ? 'published' : 'draft',
          format: 'long-form',
          viralScore: i === 0 ? 78.5 : 0,
          script: i === 0 ? {
            create: {
              content: `[OPENING_HOOK]\nThe night I found the tape, everything changed.\n\n[STORY]\n${topic} - A chilling tale that will haunt your dreams...\n\nThe entity moved through the halls like smoke through a cracked window. It had been waiting. Watching. For years.\n\nSarah didn't believe the stories. She laughed at the warnings. But when the knocking started at exactly 3:03 AM, she learned the truth.\n\nSome doors should never be opened.\nSome questions should never be answered.\nAnd some things... some things should never be remembered.\n\n[FINAL_LINE]\nIf you hear knocking tonight, don't answer. It's already inside.`,
              hook: 'The night I found the tape, everything changed.',
              wordCount: 125,
              tone: channel.tone,
              targetLength: '8-12min',
            },
          } : undefined,
        },
      });
      console.log(`  Project: ${project.topic} [${project.status}]`);
    }
  }

  console.log('\nSeed complete!');
  console.log(`  Users:    2 (system + demo)`);
  console.log(`  Channels: 3 (Shadows Unseen, Mind Gap, Archive 87)`);
  console.log(`  Demo login: demo@youtube-ai-platform.com / demo123456`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
