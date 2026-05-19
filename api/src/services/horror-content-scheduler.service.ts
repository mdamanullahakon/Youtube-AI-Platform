import cron from 'node-cron';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { HorrorScriptAgent } from '../agents/horror-script.agent';
import { scriptQueue, renderQueue, uploadQueue } from '../queues/video.queue';
import { StrategyEngine } from './strategy-engine.service';

const HORROR_SUB_NICHES = [
  'paranormal', 'psychological', 'analog-horror', 'missing-persons',
  'emergency-recordings', 'rural-isolation', 'abandoned-places',
  'ritual-horror', 'family-secrets', 'forest-horror',
  'sleep-experiments', 'possession', 'unknown-entities',
  'time-loop-horror', 'dark-water', 'mimic-entities',
  'surveillance-horror', 'vhs-tape',
];

const VIRAL_HORROR_TOPICS = [
  'What if the voice you hear at night is not in your head',
  'The last emergency broadcast before the power went out',
  'I found a door in my basement that should not exist',
  'My reflection stopped copying me 3 days ago',
  'The entity that mimics dead relatives',
  'The abandoned asylum recording that was never supposed to be found',
  'They told me not to open door 7 after midnight',
  'The forest where people go missing every 27 years',
  'My dead mother called me last night',
  'The sleep experiment that went terribly wrong',
  'I found a VHS tape in my attic that shows my house 30 years ago',
  'The neighbor who never left their house for 20 years',
  'The mirror in room 13 shows a different timeline',
  'The missing person case that was solved by a wrong number',
  'There is something living in the crawlspace',
  'The lighthouse keeper who disappeared without a trace',
  'The orphanage where children see things they should not',
  'The train that arrives at a station that does not exist',
  'The woman who has been watching my house for 47 days',
  'My doppelganger has been living my life for the past year',
  'The radio station that only broadcasts at 3 AM',
  'The lake where drowning victims rise on full moons',
  'My child has been having conversations with an empty chair',
  'The town that erases itself from every map',
  'There is a man in my security footage who does not exist',
];

interface DailyContentPlan {
  date: string;
  topics: {
    topic: string;
    subNiche: string;
    title: string;
    status: 'pending' | 'generated' | 'failed';
    projectId?: string;
  }[];
}

export class HorrorContentScheduler {
  private horrorAgent: HorrorScriptAgent;
  private strategyEngine: StrategyEngine;
  private topicIndex: number = 0;
  private nicheIndex: number = 0;
  private jobs: cron.ScheduledTask[] = [];

  constructor() {
    this.horrorAgent = new HorrorScriptAgent();
    this.strategyEngine = new StrategyEngine();
  }

  initialize(): void {
    const enabled = process.env.HORROR_AUTO_GENERATE_ENABLED === 'true';
    if (!enabled) {
      logger.info('Horror auto-generation is disabled (set HORROR_AUTO_GENERATE_ENABLED=true to enable)');
      return;
    }

    const schedule = process.env.HORROR_GENERATE_CRON || '0 6,18 * * *';
    logger.info(`Horror content scheduler initialized (${schedule})`);

    const job = cron.schedule(schedule, () => {
      this.generateDailyBatch().catch((err) => {
        logger.error('Horror daily batch generation failed', { error: err.message });
      });
    });
    this.jobs.push(job);

    const planSchedule = process.env.HORROR_PLAN_CRON || '0 5 * * *';
    const planJob = cron.schedule(planSchedule, () => {
      this.createDailyPlan().catch((err) => {
        logger.error('Horror daily planning failed', { error: err.message });
      });
    });
    this.jobs.push(planJob);
  }

  stop(): void {
    for (const job of this.jobs) {
      job.stop();
    }
    this.jobs = [];
  }

  async createDailyPlan(): Promise<DailyContentPlan> {
    const today = new Date().toISOString().split('T')[0];
    const existingPlan = await this.getCachedPlan(today);
    if (existingPlan) return existingPlan;

    const topics = this.selectTopicsForDay(3);
    const plan: DailyContentPlan = { date: today, topics };

    await prisma.appConfig.upsert({
      where: { key: `daily_plan_${today}` },
      update: { value: JSON.stringify(plan) },
      create: { key: `daily_plan_${today}`, value: JSON.stringify(plan) },
    });

    logger.info(`Daily plan created: ${topics.length} topics for ${today}`);
    return plan;
  }

  async generateDailyBatch(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const existingPlan = await this.getCachedPlan(today);
    const topics = existingPlan?.topics || this.selectTopicsForDay(2);

    const generated: string[] = [];
    const failed: string[] = [];

    for (const item of topics) {
      if (item.status === 'generated') continue;
      try {
        const result = await this.generateAndQueueHorrorVideo(item.topic, item.subNiche);
        item.status = 'generated';
        item.projectId = result.projectId;
        item.title = result.title;
        generated.push(item.topic);
        logger.info(`Generated horror video: "${result.title}" for topic "${item.topic}"`);

        await new Promise((resolve) => setTimeout(resolve, 30000));
      } catch (err: any) {
        item.status = 'failed';
        failed.push(item.topic);
        logger.error(`Failed to generate horror video for topic "${item.topic}"`, { error: err.message });
      }
    }

    const updatedPlan: DailyContentPlan = { date: today, topics };
    await prisma.appConfig.upsert({
      where: { key: `daily_plan_${today}` },
      update: { value: JSON.stringify(updatedPlan) },
      create: { key: `daily_plan_${today}`, value: JSON.stringify(updatedPlan) },
    });

    const todayCount = await prisma.videoProject.count({
      where: { createdAt: { gte: new Date(today) } },
    });

    logger.info(`[HORROR BATCH] Generated: ${generated.length}, Failed: ${failed.length}, Total today: ${todayCount}`);
  }

  async getDailyPlan(date?: string): Promise<DailyContentPlan | null> {
    const target = date || new Date().toISOString().split('T')[0];
    return this.getCachedPlan(target);
  }

  private async getCachedPlan(date: string): Promise<DailyContentPlan | null> {
    try {
      const cached = await prisma.appConfig.findUnique({ where: { key: `daily_plan_${date}` } });
      if (cached) return JSON.parse(cached.value) as DailyContentPlan;
    } catch { }
    return null;
  }

  private selectTopicsForDay(count: number): DailyContentPlan['topics'] {
    const topics: DailyContentPlan['topics'] = [];
    const usedTopics = new Set<string>();
    const usedNiches = new Set<string>();

    for (let i = 0; i < count; i++) {
      const nicheIndex = this.nicheIndex % HORROR_SUB_NICHES.length;
      const subNiche = HORROR_SUB_NICHES[nicheIndex];
      this.nicheIndex++;

      let topic: string;
      let attempts = 0;
      do {
        const topicIndex = this.topicIndex % VIRAL_HORROR_TOPICS.length;
        topic = VIRAL_HORROR_TOPICS[topicIndex];
        this.topicIndex++;
        attempts++;
      } while (usedTopics.has(topic) && attempts < VIRAL_HORROR_TOPICS.length);

      usedTopics.add(topic);
      usedNiches.add(subNiche);

      topics.push({
        topic,
        subNiche,
        title: '',
        status: 'pending',
      });
    }

    return topics;
  }

  private async generateAndQueueHorrorVideo(topic: string, subNiche: string): Promise<{ projectId: string; title: string }> {
    const story = await this.horrorAgent.generateHorrorStory(topic, subNiche, '8-12min');

    const project = await prisma.videoProject.create({
      data: {
        userId: 'system',
        topic,
        title: story.viralTitle,
        format: 'long-form',
        status: 'script_generated',
        viralScore: 85,
      },
    });

    await prisma.script.create({
      data: {
        projectId: project.id,
        content: story.fullScript,
        targetLength: 'long-form',
        wordCount: story.wordCount,
        hook: story.openingHook,
      },
    });

    const scheduleResult = await prisma.uploadSchedule.create({
      data: {
        channelId: '',
        userId: 'system',
        niche: subNiche,
        frequency: 'daily',
        nextScheduledAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
        projectId: project.id,
        status: 'pending',
      },
    });

    const scriptJob = await scriptQueue.add('script-generation', {
      projectId: project.id,
      topic: story.viralTitle,
      format: 'long-form',
    });

    return { projectId: project.id, title: story.viralTitle };
  }
}

export const horrorContentScheduler = new HorrorContentScheduler();
