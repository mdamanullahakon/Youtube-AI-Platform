export interface ViralIntelligenceReport {
  topic: string;
  category: TopicCategory;
  trendScore: number;
  competitionLevel: 'low' | 'medium' | 'high';
  searchDemand: number;
  noveltyScore: number;
  ctrScore: number;
  retentionScore: number;
  monetizationScore: number;
  saturationScore: number;
  viralScore: number;
  decision: 'ALLOW' | 'REJECT' | 'REGENERATE';
  improvementSuggestions: string[];
  subScores: {
    ctr: CtrSubScore;
    retention: RetentionSubScore;
    monetization: MonetizationSubScore;
    saturation: SaturationSubScore;
    topic: TopicSubScore;
  };
  predictionId?: string;
}

export interface CtrSubScore {
  score: number;
  hookStrength: number;
  curiosityGap: number;
  emotionalTrigger: number;
  powerWords: number;
  titleVariations?: string[];
}

export interface RetentionSubScore {
  score: number;
  hookStrength: number;
  pacing: number;
  storyStructure: number;
  emotionalArc: number;
}

export interface MonetizationSubScore {
  score: number;
  advertiserDemand: number;
  nicheValue: number;
  audienceGeo: number;
  estimatedRpm?: number;
}

export interface SaturationSubScore {
  score: number;
  keywordCompetition: number;
  contentRedundancy: number;
  trendSaturation: number;
}

export interface TopicSubScore {
  score: number;
  trend: number;
  competition: number;
  searchDemand: number;
  novelty: number;
}

export type TopicCategory =
  | 'ai'
  | 'finance'
  | 'tech'
  | 'lifestyle'
  | 'health'
  | 'education'
  | 'entertainment'
  | 'gaming'
  | 'business'
  | 'science'
  | 'self-improvement'
  | 'other';

export interface ViralWeights {
  ctrWeight: number;
  retentionWeight: number;
  monetizationWeight: number;
  trendWeight: number;
  saturationPenalty: number;
}

export interface WinningHook {
  text: string;
  category: string;
  avgCtr: number;
  avgRetention: number;
  sampleSize: number;
  score: number;
}

export interface ViralTopicRecord {
  topic: string;
  category: string;
  viralScore: number;
  avgViews: number;
  count: number;
}

export interface HighRetentionStructure {
  patternType: string;
  content: string;
  avgRetention: number;
  sampleSize: number;
}
