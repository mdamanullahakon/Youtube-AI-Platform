import { prisma } from '../config/db';
import { securityConfig } from '../config/security';
import { estimateCost } from '../utils/token-estimator';

const DAILY_RESET_KEY = 'ai:dailyReset';

export class AIUsageService {
  static async track(userId: string, provider: string, model: string, inputTokens: number, outputTokens: number, duration: number, success: boolean, error?: string) {
    const estimatedCost = estimateCost(provider, model, inputTokens, outputTokens);

    try {
      await prisma.aIUsage.create({
        data: {
          userId,
          provider,
          model,
          tokens: inputTokens + outputTokens,
          estimatedCost,
          promptLength: inputTokens,
          duration,
          success,
          error,
        },
      });
    } catch (err) {
      console.error('[AIUsage] Failed to track usage:', err);
    }
  }

  static async getDailyUsage(userId: string): Promise<{ count: number; tokens: number; cost: number }> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const records = await prisma.aIUsage.findMany({
      where: {
        userId,
        createdAt: { gte: startOfDay },
      },
    });

    return {
      count: records.length,
      tokens: records.reduce((s, r) => s + r.tokens, 0),
      cost: parseFloat(records.reduce((s, r) => s + r.estimatedCost, 0).toFixed(6)),
    };
  }

  static async checkDailyLimit(userId: string): Promise<{ allowed: boolean; remaining: number; limit: number }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    const plan = user?.subscription?.plan || 'free';
    const limit = plan === 'free' ? securityConfig.ai.dailyLimitFree : securityConfig.ai.dailyLimitPro;

    const usage = await AIUsageService.getDailyUsage(userId);
    const remaining = Math.max(0, limit - usage.count);

    return { allowed: remaining > 0, remaining, limit };
  }
}
