import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { ScoredTopic, DailyTopicReport } from './daily-content-planner.service';

export interface TopicSelectionResult {
  selectedTopic: ScoredTopic;
  selectionMethod: 'manual' | 'auto-best' | 'auto-fallback';
  allTopics: ScoredTopic[];
  selectedAt: Date;
  channelId: string;
  confirmationDeadline: Date | null;
  userConfirmed: boolean;
}

const AUTO_SELECT_TIMEOUT_MS = 1800000;
const TOPIC_SELECTION_KEY_PREFIX = 'income:topic_selection:';

export class TopicSelector {
  async presentTopicsToUser(report: DailyTopicReport): Promise<TopicSelectionResult> {
    const channelId = report.channelId;
    const sorted = report.topics.sort((a, b) => b.totalScore - a.totalScore);

    const deadline = new Date(Date.now() + AUTO_SELECT_TIMEOUT_MS);
    const selectionKey = `${TOPIC_SELECTION_KEY_PREFIX}${channelId}:${new Date().toISOString().split('T')[0]}`;

    const existing = await prisma.appConfig.findUnique({ where: { key: selectionKey } });
    if (existing) {
      const parsed = JSON.parse(existing.value);
      if (parsed.userChoice) {
        const chosen = sorted.find(t => t.id === parsed.userChoice);
        if (chosen) {
          logger.info(`[TopicSelector] ${report.channelTitle}: User had pre-selected topic "${chosen.title}"`);
          return {
            selectedTopic: chosen,
            selectionMethod: 'manual',
            allTopics: sorted,
            selectedAt: new Date(),
            channelId,
            confirmationDeadline: null,
            userConfirmed: true,
          };
        }
      }
      if (parsed.autoSelected) {
        const autoChosen = sorted.find(t => t.id === parsed.autoSelected);
        if (autoChosen) {
          logger.info(`[TopicSelector] ${report.channelTitle}: Previously auto-selected "${autoChosen.title}"`);
          return {
            selectedTopic: autoChosen,
            selectionMethod: 'auto-best',
            allTopics: sorted,
            selectedAt: new Date(),
            channelId,
            confirmationDeadline: null,
            userConfirmed: true,
          };
        }
      }
    }

    const best = sorted[0];
    if (!best) throw new Error(`No topics available for channel ${channelId}`);

    logger.info(`[TopicSelector] ${report.channelTitle}: Topics presented for selection. Waiting ${AUTO_SELECT_TIMEOUT_MS / 60000}min for user input.`);
    logger.info(`  Best topic: "${best.title}" (Score: ${best.totalScore})`);

    const saved = await prisma.appConfig.upsert({
      where: { key: selectionKey },
      update: {
        value: JSON.stringify({
          topics: sorted,
          autoSelected: best.id,
          autoSelectedAt: new Date().toISOString(),
          deadline: deadline.toISOString(),
        }),
      },
      create: {
        key: selectionKey,
        value: JSON.stringify({
          topics: sorted,
          autoSelected: best.id,
          autoSelectedAt: new Date().toISOString(),
          deadline: deadline.toISOString(),
        }),
        description: `Topic selection for ${channelId} on ${new Date().toISOString().split('T')[0]}`,
      },
    });

    return {
      selectedTopic: best,
      selectionMethod: 'auto-best',
      allTopics: sorted,
      selectedAt: new Date(),
      channelId,
      confirmationDeadline: deadline,
      userConfirmed: false,
    };
  }

  async waitForUserConfirmation(
    channelId: string,
    deadline: Date,
    pollIntervalMs = 10000
  ): Promise<{ topicId: string | null; timedOut: boolean }> {
    const selectionKey = `${TOPIC_SELECTION_KEY_PREFIX}${channelId}:${new Date().toISOString().split('T')[0]}`;

    while (Date.now() < deadline.getTime()) {
      const record = await prisma.appConfig.findUnique({ where: { key: selectionKey } });
      if (record) {
        try {
          const data = JSON.parse(record.value);
          if (data.userChoice) {
            return { topicId: data.userChoice, timedOut: false };
          }
        } catch {}
      }
      await this.sleep(pollIntervalMs);
    }

    return { topicId: null, timedOut: true };
  }

  async resolveSelection(report: DailyTopicReport, userChoiceId: string | null): Promise<TopicSelectionResult> {
    const sorted = report.topics.sort((a, b) => b.totalScore - a.totalScore);

    if (userChoiceId) {
      const chosen = sorted.find(t => t.id === userChoiceId);
      if (chosen) {
        await this.saveUserChoice(report.channelId, userChoiceId);
        logger.info(`[TopicSelector] ${report.channelTitle}: User selected "${chosen.title}"`);
        return {
          selectedTopic: chosen,
          selectionMethod: 'manual',
          allTopics: sorted,
          selectedAt: new Date(),
          channelId: report.channelId,
          confirmationDeadline: null,
          userConfirmed: true,
        };
      }
    }

    const best = sorted[0];
    if (!best) throw new Error(`No topics available for channel ${report.channelId}`);

    await this.saveAutoSelection(report.channelId, best.id);
    logger.info(`[TopicSelector] ${report.channelTitle}: Auto-selected "${best.title}" (Score: ${best.totalScore})`);

    return {
      selectedTopic: best,
      selectionMethod: 'auto-best',
      allTopics: sorted,
      selectedAt: new Date(),
      channelId: report.channelId,
      confirmationDeadline: null,
      userConfirmed: true,
    };
  }

  async setUserChoice(channelId: string, topicId: string): Promise<boolean> {
    const selectionKey = `${TOPIC_SELECTION_KEY_PREFIX}${channelId}:${new Date().toISOString().split('T')[0]}`;
    const record = await prisma.appConfig.findUnique({ where: { key: selectionKey } });
    if (!record) return false;

    try {
      const data = JSON.parse(record.value);
      data.userChoice = topicId;
      data.userChosenAt = new Date().toISOString();
      await prisma.appConfig.update({
        where: { key: selectionKey },
        data: { value: JSON.stringify(data) },
      });
      return true;
    } catch {
      return false;
    }
  }

  private async saveUserChoice(channelId: string, topicId: string): Promise<void> {
    const selectionKey = `${TOPIC_SELECTION_KEY_PREFIX}${channelId}:${new Date().toISOString().split('T')[0]}`;
    const record = await prisma.appConfig.findUnique({ where: { key: selectionKey } });
    if (record) {
      const data = JSON.parse(record.value);
      data.userChoice = topicId;
      data.userChosenAt = new Date().toISOString();
      await prisma.appConfig.update({
        where: { key: selectionKey },
        data: { value: JSON.stringify(data) },
      });
    }
  }

  private async saveAutoSelection(channelId: string, topicId: string): Promise<void> {
    const selectionKey = `${TOPIC_SELECTION_KEY_PREFIX}${channelId}:${new Date().toISOString().split('T')[0]}`;
    await prisma.appConfig.upsert({
      where: { key: selectionKey },
      update: { value: JSON.stringify({ autoSelected: topicId, autoSelectedAt: new Date().toISOString() }) },
      create: {
        key: selectionKey,
        value: JSON.stringify({ autoSelected: topicId, autoSelectedAt: new Date().toISOString() }),
        description: `Auto-selected topic for ${channelId}`,
      },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
