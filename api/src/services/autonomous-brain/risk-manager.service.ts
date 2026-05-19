import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { redisConnection } from '../../config/redis';

export interface RiskStatus {
  channelId: string;
  channelTitle: string;
  apiQuotaRemaining: number;
  oauthHealthy: boolean;
  uploadCooldownActive: boolean;
  cooldownRemainingMs: number;
  consecutiveFailures: number;
  strikeCount: number;
  isPaused: boolean;
  riskLevel: 'safe' | 'caution' | 'elevated' | 'critical';
  riskFactors: string[];
  monetizationViolations: number;
  lowCTRVideoCount: number;
  lowRetentionVideoCount: number;
}

export interface RiskReport {
  totalChannels: number;
  safeChannels: number;
  cautionChannels: number;
  elevatedChannels: number;
  criticalChannels: number;
  apiQuotaUsed: number;
  apiQuotaRemaining: number;
  totalStrikes: number;
  channelsOnCooldown: number;
  autoPausedChannels: string[];
  channelsWithViolations: string[];
  channelsWithLowPerformance: string[];
}

const UPLOAD_COOLDOWN_KEY = 'risk:upload_cooldown';
const API_QUOTA_KEY = 'risk:api_quota_used';
const CONSECUTIVE_FAIL_KEY = 'risk:consecutive_failures';
const STRIKE_KEY = 'risk:strikes';
const MAX_DAILY_API_CALLS = 10000;
const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_STRIKES = 3;
const UPLOAD_COOLDOWN_MS = 3600000;
const LOW_CTR_THRESHOLD = 3;
const LOW_RETENTION_THRESHOLD = 30;
const LOW_CTR_SPAM_LIMIT = 5;
const LOW_RETENTION_SPAM_LIMIT = 5;

export class RiskManager {
  async checkChannelRisk(channelId: string): Promise<RiskStatus> {
    const channel = await prisma.youTubeAccount.findFirst({ where: { channelId } });
    if (!channel) {
      return {
        channelId, channelTitle: 'Unknown',
        apiQuotaRemaining: 0, oauthHealthy: false,
        uploadCooldownActive: false, cooldownRemainingMs: 0,
        consecutiveFailures: 0, strikeCount: 0,
        isPaused: true, riskLevel: 'critical',
        riskFactors: ['Channel not found'],
        monetizationViolations: 0,
        lowCTRVideoCount: 0,
        lowRetentionVideoCount: 0,
      };
    }

    const apiQuotaUsed = await this.getApiQuotaUsed();
    const apiQuotaRemaining = Math.max(0, MAX_DAILY_API_CALLS - apiQuotaUsed);

    const consecutiveFailures = await this.getConsecutiveFailures(channelId);
    const strikeCount = await this.getStrikes(channelId);

    const cooldownUntil = await redisConnection?.get(`${UPLOAD_COOLDOWN_KEY}:${channelId}`);
    const uploadCooldownActive = !!cooldownUntil && parseInt(cooldownUntil) > Date.now();
    const cooldownRemainingMs = uploadCooldownActive
      ? Math.max(0, parseInt(cooldownUntil || '0') - Date.now())
      : 0;

    const tokenExpired = channel.tokenExpiresAt && new Date(channel.tokenExpiresAt) < new Date();
    const oauthHealthy = !tokenExpired && channel.isConnected;

    const schedule = await prisma.uploadSchedule.findFirst({
      where: { channelId, status: 'active' },
    });
    const isPaused = !schedule || schedule.status !== 'active';

    const { lowCTRCount, lowRetentionCount } = await this.getLowPerformanceCounts(channelId);
    const monetizationViolations = await this.detectMonetizationViolations(channelId);

    const riskFactors: string[] = [];
    if (apiQuotaRemaining < 1000) riskFactors.push(`Low API quota (${apiQuotaRemaining} remaining)`);
    if (!oauthHealthy) riskFactors.push('OAuth token expired or disconnected');
    if (uploadCooldownActive) riskFactors.push(`Upload cooldown active (${Math.round(cooldownRemainingMs / 60000)}min remaining)`);
    if (consecutiveFailures > 2) riskFactors.push(`${consecutiveFailures} consecutive failures`);
    if (strikeCount > 0) riskFactors.push(`${strikeCount} strike(s) against channel`);
    if (isPaused) riskFactors.push('Channel paused');
    if (monetizationViolations > 0) riskFactors.push(`${monetizationViolations} monetization violation(s)`);
    if (lowCTRCount >= LOW_CTR_SPAM_LIMIT) riskFactors.push(`${lowCTRCount} videos with low CTR — spam risk`);
    if (lowRetentionCount >= LOW_RETENTION_SPAM_LIMIT) riskFactors.push(`${lowRetentionCount} videos with low retention — quality risk`);

    let riskLevel: RiskStatus['riskLevel'] = 'safe';
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES || strikeCount >= MAX_STRIKES || monetizationViolations >= 3) {
      riskLevel = 'critical';
    } else if (apiQuotaRemaining < 500 || uploadCooldownActive || strikeCount >= 2 || lowCTRCount >= LOW_CTR_SPAM_LIMIT) {
      riskLevel = 'elevated';
    } else if (apiQuotaRemaining < 2000 || consecutiveFailures >= 3 || lowRetentionCount >= LOW_RETENTION_SPAM_LIMIT) {
      riskLevel = 'caution';
    }

    return {
      channelId, channelTitle: channel.channelTitle || '',
      apiQuotaRemaining, oauthHealthy,
      uploadCooldownActive, cooldownRemainingMs,
      consecutiveFailures, strikeCount, isPaused,
      riskLevel, riskFactors,
      monetizationViolations,
      lowCTRVideoCount: lowCTRCount,
      lowRetentionVideoCount: lowRetentionCount,
    };
  }

  async canUpload(channelId: string): Promise<{ allowed: boolean; reason?: string }> {
    const risk = await this.checkChannelRisk(channelId);

    if (risk.riskLevel === 'critical') {
      return { allowed: false, reason: `Critical risk: ${risk.riskFactors.join(', ')}` };
    }

    if (risk.isPaused) {
      return { allowed: false, reason: 'Channel is paused' };
    }

    if (risk.uploadCooldownActive) {
      return { allowed: false, reason: `Upload cooldown: ${Math.round(risk.cooldownRemainingMs / 60000)}min remaining` };
    }

    if (risk.apiQuotaRemaining < 100) {
      return { allowed: false, reason: 'API quota exhausted for today' };
    }

    if (!risk.oauthHealthy) {
      return { allowed: false, reason: 'OAuth token expired — reconnect required' };
    }

    if (risk.lowCTRVideoCount >= LOW_CTR_SPAM_LIMIT) {
      return { allowed: false, reason: `Blocked: ${risk.lowCTRVideoCount} low-CTR videos — content quality issue` };
    }

    if (risk.lowRetentionVideoCount >= LOW_RETENTION_SPAM_LIMIT) {
      return { allowed: false, reason: `Blocked: ${risk.lowRetentionVideoCount} low-retention videos — audience retention issue` };
    }

    return { allowed: true };
  }

  async recordUploadSuccess(channelId: string): Promise<void> {
    await redisConnection?.del(`${CONSECUTIVE_FAIL_KEY}:${channelId}`);
    await this.incrementApiQuota(1);
    logger.debug(`[RiskManager] Upload success recorded for ${channelId}`);
  }

  async recordUploadFailure(channelId: string, error: string): Promise<void> {
    const failures = await this.incrementConsecutiveFailures(channelId);
    logger.warn(`[RiskManager] Upload failure for ${channelId} (${failures}/${MAX_CONSECUTIVE_FAILURES}): ${error}`);

    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      await this.activateCooldown(channelId, 4);
      await this.incrementStrikes(channelId);
      logger.warn(`[RiskManager] MAX FAILURES reached for ${channelId}. Cooldown + strike activated.`);
    } else if (failures >= 3) {
      await this.activateCooldown(channelId, 1);
    }
  }

  async activateCooldown(channelId: string, hours: number): Promise<void> {
    const until = Date.now() + (hours * UPLOAD_COOLDOWN_MS);
    await redisConnection?.set(`${UPLOAD_COOLDOWN_KEY}:${channelId}`, until.toString(), 'EX', hours * 3600);
    logger.warn(`[RiskManager] Upload cooldown activated for ${channelId} (${hours}h)`);
  }

  async recordStrike(channelId: string, reason: string): Promise<void> {
    const strikes = await this.incrementStrikes(channelId);
    logger.warn(`[RiskManager] Strike recorded for ${channelId} (${strikes}/${MAX_STRIKES}): ${reason}`);

    if (strikes >= MAX_STRIKES) {
      await prisma.youTubeAccount.updateMany({
        where: { channelId },
        data: { isConnected: false },
      });
      await prisma.uploadSchedule.updateMany({
        where: { channelId },
        data: { status: 'paused' },
      });
      logger.error(`[RiskManager] Channel ${channelId} DISCONNECTED after ${MAX_STRIKES} strikes`);
    }
  }

  async recordLowCTRVideo(channelId: string): Promise<void> {
    const key = `risk:low_ctr:${channelId}`;
    const count = await redisConnection?.incr(key);
    if (count === 1) await redisConnection?.expire(key, 604800);
    const current = await this.getLowCTRCount(channelId);
    if (current >= LOW_CTR_SPAM_LIMIT) {
      await this.activateCooldown(channelId, 24);
      logger.warn(`[RiskManager] ${channelId} paused for 24h due to ${current} low-CTR videos`);
    }
  }

  async recordLowRetentionVideo(channelId: string): Promise<void> {
    const key = `risk:low_retention:${channelId}`;
    const count = await redisConnection?.incr(key);
    if (count === 1) await redisConnection?.expire(key, 604800);
    const current = await this.getLowRetentionCount(channelId);
    if (current >= LOW_RETENTION_SPAM_LIMIT) {
      await this.activateCooldown(channelId, 12);
      logger.warn(`[RiskManager] ${channelId} paused for 12h due to ${current} low-retention videos`);
    }
  }

  async getOverallRiskReport(): Promise<RiskReport> {
    const channels = await prisma.youTubeAccount.findMany({ where: { isConnected: true } });
    const statuses = await Promise.all(channels.map(c => this.checkChannelRisk(c.channelId)));

    return {
      totalChannels: channels.length,
      safeChannels: statuses.filter(s => s.riskLevel === 'safe').length,
      cautionChannels: statuses.filter(s => s.riskLevel === 'caution').length,
      elevatedChannels: statuses.filter(s => s.riskLevel === 'elevated').length,
      criticalChannels: statuses.filter(s => s.riskLevel === 'critical').length,
      apiQuotaUsed: await this.getApiQuotaUsed(),
      apiQuotaRemaining: MAX_DAILY_API_CALLS - await this.getApiQuotaUsed(),
      totalStrikes: statuses.reduce((s, r) => s + r.strikeCount, 0),
      channelsOnCooldown: statuses.filter(s => s.uploadCooldownActive).length,
      autoPausedChannels: statuses.filter(s => s.isPaused).map(s => s.channelId),
      channelsWithViolations: statuses.filter(s => s.monetizationViolations > 0).map(s => s.channelId),
      channelsWithLowPerformance: statuses.filter(s => s.lowCTRVideoCount >= LOW_CTR_SPAM_LIMIT || s.lowRetentionVideoCount >= LOW_RETENTION_SPAM_LIMIT).map(s => s.channelId),
    };
  }

  async autoPauseRiskyChannels(): Promise<{ paused: string[] }> {
    const channels = await prisma.youTubeAccount.findMany({ where: { isConnected: true } });
    const paused: string[] = [];

    for (const channel of channels) {
      const risk = await this.checkChannelRisk(channel.channelId);
      if (risk.riskLevel === 'critical' && !risk.isPaused) {
        await prisma.uploadSchedule.updateMany({
          where: { channelId: channel.channelId },
          data: { status: 'paused' },
        });
        paused.push(channel.channelId);
        logger.warn(`[RiskManager] Auto-paused ${channel.channelTitle} due to critical risk`);
      }
    }

    return { paused };
  }

  async validateContentQuality(channelId: string): Promise<{
    pass: boolean;
    reasons: string[];
  }> {
    const reasons: string[] = [];
    const projects = await prisma.videoProject.findMany({
      where: { channelId, uploadHistory: { status: 'published' } },
      include: { analytics: true, contentPerformance: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (projects.length === 0) return { pass: true, reasons: ['No projects to validate'] };

    const lowCTRVideos = projects.filter(p => (p.analytics?.ctr || 0) < LOW_CTR_THRESHOLD);
    const lowRetentionVideos = projects.filter(p => (p.analytics?.retention || 0) < LOW_RETENTION_THRESHOLD);

    if (lowCTRVideos.length >= LOW_CTR_SPAM_LIMIT) {
      reasons.push(`${lowCTRVideos.length}/${projects.length} videos have CTR < ${LOW_CTR_THRESHOLD}%`);
    }
    if (lowRetentionVideos.length >= LOW_RETENTION_SPAM_LIMIT) {
      reasons.push(`${lowRetentionVideos.length}/${projects.length} videos have retention < ${LOW_RETENTION_THRESHOLD}%`);
    }

    return {
      pass: reasons.length === 0,
      reasons: reasons.length > 0 ? reasons : ['Content quality acceptable'],
    };
  }

  private async getLowPerformanceCounts(channelId: string): Promise<{ lowCTRCount: number; lowRetentionCount: number }> {
    const lowCTRCount = await this.getLowCTRCount(channelId);
    const lowRetentionCount = await this.getLowRetentionCount(channelId);
    return { lowCTRCount, lowRetentionCount };
  }

  private async getLowCTRCount(channelId: string): Promise<number> {
    const val = await redisConnection?.get(`risk:low_ctr:${channelId}`);
    return val ? parseInt(val) : 0;
  }

  private async getLowRetentionCount(channelId: string): Promise<number> {
    const val = await redisConnection?.get(`risk:low_retention:${channelId}`);
    return val ? parseInt(val) : 0;
  }

  private async detectMonetizationViolations(channelId: string): Promise<number> {
    const projects = await prisma.videoProject.findMany({
      where: {
        channelId,
        uploadHistory: { status: 'published' },
      },
      include: { analytics: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    let violations = 0;
    for (const p of projects) {
      if (p.analytics) {
        const views = p.analytics.views || 0;
        const ctr = p.analytics.ctr || 0;
        if (views > 1000 && ctr < 1) violations++;
      }
    }
    return violations;
  }

  private async getApiQuotaUsed(): Promise<number> {
    const val = await redisConnection?.get(API_QUOTA_KEY);
    return val ? parseInt(val) : 0;
  }

  private async incrementApiQuota(count: number): Promise<void> {
    const current = await this.getApiQuotaUsed();
    const ttl = await redisConnection?.ttl(API_QUOTA_KEY);
    if (ttl && ttl < 0) {
      await redisConnection?.set(API_QUOTA_KEY, count.toString(), 'EX', 86400);
    } else {
      await redisConnection?.set(API_QUOTA_KEY, (current + count).toString(), 'EX', 86400);
    }
  }

  private async getConsecutiveFailures(channelId: string): Promise<number> {
    const val = await redisConnection?.get(`${CONSECUTIVE_FAIL_KEY}:${channelId}`);
    return val ? parseInt(val) : 0;
  }

  private async incrementConsecutiveFailures(channelId: string): Promise<number> {
    const current = await this.getConsecutiveFailures(channelId);
    const next = current + 1;
    await redisConnection?.set(`${CONSECUTIVE_FAIL_KEY}:${channelId}`, next.toString(), 'EX', 86400);
    return next;
  }

  private async getStrikes(channelId: string): Promise<number> {
    const val = await redisConnection?.get(`${STRIKE_KEY}:${channelId}`);
    return val ? parseInt(val) : 0;
  }

  private async incrementStrikes(channelId: string): Promise<number> {
    const current = await this.getStrikes(channelId);
    const next = current + 1;
    await redisConnection?.set(`${STRIKE_KEY}:${channelId}`, next.toString(), 'EX', 604800);
    return next;
  }
}
