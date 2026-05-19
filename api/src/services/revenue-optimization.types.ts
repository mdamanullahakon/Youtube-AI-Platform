export interface RevenueReport {
  topic: string;
  revenueForecast: RevenueForecast;
  profitabilityTier: ProfitabilityTier;
  usRevenueMultiplier: number;
  adsenseRevenue: RevenueStreamEstimate;
  affiliateRevenue: RevenueStreamEstimate;
  totalMonetizationScore: number;
  decision: 'APPROVE' | 'OPTIMIZE' | 'REJECT';
  optimizationSuggestions: string[];
  subScores: {
    forecast: ForecastSubScore;
    profitability: ProfitabilitySubScore;
    multiStream: MultiStreamSubScore;
  };
}

export interface RevenueForecast {
  minEstimate: number;
  maxEstimate: number;
  expectedEstimate: number;
  confidence: number;
  breakdown: {
    adsense: number;
    affiliate: number;
    external: number;
  };
}

export type ProfitabilityTier = 'loss' | 'break-even' | 'profitable' | 'high-profit' | 'viral-cash-machine';

export interface RevenueStreamEstimate {
  potential: number;
  confidence: number;
  factors: string[];
}

export interface ForecastSubScore {
  score: number;
  expectedViews: number;
  rpm: number;
  affiliateConversionProb: number;
  retentionImpact: number;
}

export interface ProfitabilitySubScore {
  score: number;
  tier: ProfitabilityTier;
  rpmTier: string;
  ctrTier: string;
}

export interface MultiStreamSubScore {
  score: number;
  adsenseFit: number;
  affiliateFit: number;
  externalFit: number;
}
