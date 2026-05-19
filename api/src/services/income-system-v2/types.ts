export interface IncomeChannelConfig {
  channelId: string;
  userId: string;
  niche: string;
  videosPerDay: number;
  uploadTimes: string[];
  targetAudience: string;
  contentStyle: string;
  monetizationTypes: string[];
  riskThresholds: {
    minCtr: number;
    minRetention: number;
    maxFailRate: number;
  };
  enabled: boolean;
}

export interface IncomeTopicScore {
  topic: string;
  niche: string;
  viralScore: number;
  competitionScore: number;
  monetizationScore: number;
  ctrPrediction: number;
  retentionPrediction: number;
  totalScore: number;
  reasoning: string;
  source: 'trending' | 'winner-pattern' | 'ai-generated';
}

export interface IncomeVideoPlan {
  topicScore: IncomeTopicScore;
  title: string;
  script: string;
  hook: string;
  thumbnailPrompt: string;
  thumbnailStyle: string;
  seoTags: string[];
  seoDescription: string;
  categoryId: string;
  monetization: {
    affiliateLinks: Array<{ product: string; url: string; placement: string }>;
    ctaText: string;
    ctaPlacement: string;
    funnelType: string;
  };
  estimatedCpm: number;
  estimatedRevenue: number;
  channelId: string;
  userId: string;
}

export interface IncomeUploadResult {
  projectId: string;
  videoId: string | null;
  uploadStatus: 'processing' | 'uploaded' | 'failed';
  publishedAt: Date | null;
  error?: string;
}

export interface IncomeAnalyticsSnapshot {
  projectId: string;
  videoId: string;
  snapshotType: 'early' | 'full';
  minutesSinceUpload: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  ctr: number;
  retention: number;
  watchTime: number;
  subscribersGained: number;
  impressions: number;
  avgViewDuration: number;
  collectedAt: Date;
}

export interface IncomeWinnerVideo {
  projectId: string;
  videoId: string;
  channelId: string;
  title: string;
  topic: string;
  niche: string;
  hook: string;
  views: number;
  ctr: number;
  retention: number;
  revenue: number;
  hookStyle: string;
  thumbnailStyle: string;
  titleStyle: string;
  topicType: string;
  score: number;
}

export interface IncomeWinningPattern {
  patternType: 'hook-style' | 'title-style' | 'thumbnail-style' | 'topic-type' | 'cta-style' | 'video-format';
  patternValue: string;
  niche: string;
  score: number;
  sampleSize: number;
  avgViews: number;
  avgCtr: number;
  avgRetention: number;
  confidence: number;
}

export interface IncomeCycleResult {
  cycleId: string;
  channelId: string;
  userId: string;
  date: string;
  videosPlanned: number;
  videosUploaded: number;
  videosFailed: number;
  totalEstimatedRevenue: number;
  riskFlags: string[];
  completedAt: Date;
}

export interface IncomeRiskAlert {
  channelId: string;
  alertType: 'low-ctr' | 'low-retention' | 'upload-failure' | 'api-error' | 'auth-error';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  details: Record<string, unknown>;
  timestamp: Date;
}

export const INCOME_SYSTEM_QUEUES = {
  incomeTopic: 'income-topic-generation',
  incomeContent: 'income-content-generation',
  incomeMonetization: 'income-monetization-injection',
  incomeUpload: 'income-upload',
  incomeAnalytics: 'income-analytics-collection',
  incomeLearning: 'income-learning',
  incomeRisk: 'income-risk-assessment',
  incomeCycle: 'income-daily-cycle',
} as const;

export const DEFAULT_VIDEOS_PER_DAY = 3;
export const EARLY_ANALYTICS_DELAY_MIN = 30;
export const FULL_ANALYTICS_DELAY_MIN = 720;
export const MIN_CTR_THRESHOLD = 2.0;
export const MIN_RETENTION_THRESHOLD = 25;

// ─── Job Data Interfaces ────────────────────────
export interface IncomeTopicJobData {
  channelId: string;
  userId: string;
  niche: string;
  videosPerDay: number;
  cycleId: string;
}

export interface IncomeContentJobData {
  topic: string;
  viralScore: number;
  competitionScore: number;
  monetizationScore: number;
  totalScore: number;
  channelId: string;
  userId: string;
  niche: string;
  cycleId: string;
}

export interface IncomeMonetizationJobData {
  planJson: string;
  channelId: string;
  userId: string;
  niche: string;
  projectId: string;
  cycleId: string;
}

export interface IncomeUploadJobData {
  planJson: string;
  projectId: string;
  channelId: string;
  userId: string;
  cycleId: string;
}

export interface IncomeAnalyticsJobData {
  projectId: string;
  videoId: string;
  channelId: string;
  snapshotType: 'early' | 'full';
  delayMinutes: number;
}

export interface IncomeLearningJobData {
  channelId: string;
  cycleId: string;
  date: string;
}

export interface IncomeRiskJobData {
  channelId: string;
  userId: string;
  niche: string;
  cycleId: string;
  cycleLogId?: string;
}

export interface IncomeCycleJobData {
  channelId: string;
  userId: string;
  niche: string;
  configJson: string;
}
