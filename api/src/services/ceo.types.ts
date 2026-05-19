export interface CeoReport {
  businessHealthScore: number;
  growthStatus: 'EXPANDING' | 'STABLE' | 'DECLINING';
  revenueStrategySummary: string;
  contentPortfolioPlan: ContentPortfolioPlan;
  uploadSchedule: UploadScheduleCeo;
  scalingRecommendation: ScalingDecision;
  top3StrategicActions: string[];
  riskAnalysis: RiskAnalysis;
  timestamp: Date;
  channelId: string;
}

export interface ContentPortfolioPlan {
  viralPct: number;
  evergreenPct: number;
  authorityPct: number;
  weeklyPlan: CeoWeeklyItem[];
  priorityRanking: string[];
  discardList: string[];
}

export interface CeoWeeklyItem {
  day: string;
  topic: string;
  type: 'viral' | 'evergreen' | 'authority';
  expectedRevenue: number;
  confidence: number;
}

export interface UploadScheduleCeo {
  bestSlot: string;
  frequencyPerWeek: number;
  cooldownDays: number;
  timezone: string;
}

export type ScalingDecision = 'SCALE_AGGRESSIVELY' | 'OPTIMIZE_AND_STABILIZE' | 'RESTRUCTURE_STRATEGY';

export interface RiskAnalysis {
  level: 'low' | 'medium' | 'high' | 'critical';
  risks: string[];
  mitigations: string[];
}
