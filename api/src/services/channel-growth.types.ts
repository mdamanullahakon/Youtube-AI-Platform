export interface ChannelHealthReport {
  channelId: string;
  channelHealthScore: number;
  growthTrend: 'up' | 'down' | 'stable';
  weakPoints: string[];
  last10Videos: VideoPerformanceSummary[];
  ctrTrend: number[];
  retentionTrend: number[];
  subscriberGrowthRate: number;
  impressionsVsClicks: { impressions: number; clicks: number; ctr: number };
  uploadFrequency: { videosPerWeek: number; consistency: number };
}

export interface VideoPerformanceSummary {
  videoId: string;
  title: string;
  views: number;
  ctr: number;
  retention: number;
  likes: number;
  comments: number;
  publishedAt: Date;
}

export interface ContentStrategyPlan {
  channelId: string;
  weeklyPlan: WeeklyContentItem[];
  topicPriorityList: string[];
  forbiddenTopics: string[];
  winningNiches: string[];
  mixRecommendation: ContentMixRecommendation;
}

export interface WeeklyContentItem {
  day: string;
  topic: string;
  contentType: 'viral' | 'evergreen' | 'authority';
  expectedCtr: number;
  expectedRetention: number;
  hookSuggestion: string;
}

export interface ContentMixRecommendation {
  viralPct: number;
  evergreenPct: number;
  authorityPct: number;
  reasoning: string;
}

export interface UploadSchedulePlan {
  channelId: string;
  bestTimeSlots: TimeSlot[];
  optimalFrequencyPerWeek: number;
  cooldownDays: number;
  timezone: string;
}

export interface TimeSlot {
  hour: number;
  day: string;
  score: number;
  predictedViews: number;
  confidence: number;
}

export interface GrowthScoreResult {
  channelId: string;
  growthScore: number;
  avgCtr: number;
  avgRetention: number;
  subscriberGrowthRate: number;
  watchTime: number;
  consistencyScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  scalingRecommendation: string;
}

export interface StrategyDecision {
  channelId: string;
  decisionType: 'SCALE_UP' | 'STABILIZE' | 'RESTRUCTURE';
  growthScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  reasoning: string;
  actions: string[];
}

export interface ContentMixPlan {
  viralPct: number;
  evergreenPct: number;
  authorityPct: number;
  viralTopics: string[];
  evergreenTopics: string[];
  authorityTopics: string[];
}

export interface CorrectionAction {
  type: 'regenerate-title' | 'adjust-hook' | 'change-pacing' | 'shift-topic-cluster' | 'cooldown';
  severity: 'critical' | 'warning' | 'info';
  metric: string;
  currentValue: number;
  threshold: number;
  description: string;
}

export interface GrowthCycleReport {
  channelId: string;
  timestamp: Date;
  healthReport: ChannelHealthReport;
  growthScore: GrowthScoreResult;
  strategyPlan: ContentStrategyPlan;
  schedulePlan: UploadSchedulePlan;
  decision: StrategyDecision;
  corrections: CorrectionAction[];
  snapshotId?: string;
}
