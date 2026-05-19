export interface UsaMarketReport {
  topic: string;
  usaAudienceFitScore: number;
  rpmScore: number;
  ctrPredictionUsa: number;
  retentionPredictionUsa: number;
  hookStrengthScore: number;
  bestUsTitle: string;
  bestUploadTimeEst: string;
  finalDecision: 'PUBLISH' | 'OPTIMIZE' | 'REJECT';
  usaViralScore: number;
  subScores: {
    audienceAlignment: AudienceAlignmentScore;
    rpmFilter: RpmFilterScore;
    hookEngine: HookEngineScore;
    subscriberValue: SubscriberValueScore;
  };
  localizedTitle: string;
  localizedDescription: string;
  improvementNotes: string[];
}

export interface AudienceAlignmentScore {
  score: number;
  languageNatural: number;
  culturalRelevance: number;
  currencyUnit: boolean;
  unitSystem: boolean;
  toneMatch: number;
  issues: string[];
}

export interface RpmFilterScore {
  score: number;
  nicheTier: 'premium' | 'high' | 'medium' | 'low';
  estimatedCpmUsd: number;
  estimatedRpmUsd: number;
  nicheCategory: string;
}

export interface HookEngineScore {
  score: number;
  curiosityGap: number;
  valuePromise: number;
  pacing: number;
  usStyle: number;
  suggestions: string[];
}

export interface SubscriberValueScore {
  score: number;
  targetDemographic: string;
  valueAlignment: number;
  usMarketDemand: number;
}
