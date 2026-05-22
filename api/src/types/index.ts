export interface TrendAnalysis {
  topic: string;
  viralScore: number;
  competition: number;
  audience: string;
  format: string;
  trends: string[];
  competitors: string[];
  reasoning: string;
}

export interface GeneratedScript {
  content: string;
  hook: string;
  wordCount: number;
  tone: string;
  targetLength?: string;
  scenes: Scene[];
}

export interface Scene {
  text: string;
  duration: number;
  visualPrompt: string;
  mood?: string;
  pacing?: string;
  retentionHook?: string;
}

export interface VisualPrompt {
  sceneIndex: number;
  text: string;
  prompt: string;
  platform: 'runway' | 'midjourney' | 'stable-diffusion' | 'flux';
}

export interface VoiceoverResult {
  text: string;
  audioUrl: string | null;
  duration: number;
  language: string;
  tone: string;
}

export interface ThumbnailResult {
  prompt: string;
  imageUrl: string | null;
  style: string;
  ctr: number;
}

export interface SEOResult {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  keywords: string[];
}

export interface AnalyticsInsight {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  ctr: number;
  retention: number;
  watchTime: number;
  subscribersGained: number;
  avgViewDuration: number;
  impressions: number;
  performance: 'excellent' | 'good' | 'average' | 'poor';
  recommendations: string[];
}

export interface TranscriptData {
  videoId: string;
  title: string;
  transcript: string;
  language: string;
  hooks: string[];
  pacing: number;
  retentionPatterns: string[];
  callToAction: string;
  emotionalTone: string;
}

export interface YouTubeUploadOptions {
  title: string;
  description: string;
  tags: string[];
  categoryId?: string;
  privacyStatus?: 'public' | 'private' | 'unlisted';
  videoPath: string;
  thumbnailPath?: string;
  playlistId?: string;
  scheduledAt?: Date;
}

export interface PipelineJob {
  id: string;
  type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  data: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  retries: number;
  maxRetries: number;
}

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  role: string;
  subscription: {
    plan: string;
    status: string;
    videoLimit: number;
    videosUsed: number;
  };
  settings: {
    preferredModel: string;
    voiceId?: string;
  };
}

export interface DashboardStats {
  totalProjects: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalUploads: number;
  subscribersGained: number;
  averageCTR: number;
  averageRetention: number;
}

// ─── Transcript Intelligence Types ────────────────

export interface DetectedHook {
  text: string;
  type: HookType;
  position: number;
  score: number;
  reason: string;
}

export type HookType =
  | 'curiosity-gap'
  | 'pattern-interrupt'
  | 'provocative-question'
  | 'bold-statement'
  | 'shocking-statistic'
  | 'story-bait'
  | 'benefit-forward'
  | 'urgency'
  | 'controversy'
  | 'relatable-problem'
  | 'unknown';

export interface RetentionLoop {
  text: string;
  type: RetentionLoopType;
  position: number;
  effectiveness: number;
}

export type RetentionLoopType =
  | 'pattern-interrupt'
  | 'curiosity-gap'
  | 'mini-cliffhanger'
  | 'promise-preview'
  | 'question-pause'
  | 'stakes-raised'
  | 'time-jump'
  | 'reveal-tease'
  | 'unknown';

export interface PatternInterrupt {
  text: string;
  technique: string;
  position: number;
  impact: number;
}

export interface StorytellingStructure {
  name: string;
  arc: string;
  confidence: number;
  phases: StoryPhase[];
}

export interface StoryPhase {
  name: string;
  startPosition: number;
  endPosition: number;
  purpose: string;
}

export interface PacingPattern {
  overall: 'slow' | 'moderate' | 'fast' | 'varied';
  wordsPerSecond: number;
  sentenceLengthAvg: number;
  sentenceLengthVariation: number;
  segments: PacingSegment[];
  hotspots: PacingHotspot[];
}

export interface PacingSegment {
  startPosition: number;
  endPosition: number;
  label: string;
  pace: 'slow' | 'moderate' | 'fast' | 'varied';
}

export interface PacingHotspot {
  position: number;
  type: 'acceleration' | 'deceleration' | 'pause';
  intensity: number;
}

export interface HookQualityScore {
  overall: number;
  dimensions: {
    curiosity: number;
    clarity: number;
    relevance: number;
    emotionalAppeal: number;
    specificity: number;
    uniqueness: number;
    urgency: number;
  };
  strengths: string[];
  weaknesses: string[];
}

export interface EngagementScore {
  overall: number;
  dimensions: {
    hookRetention: number;
    pacingOptimality: number;
    narrativeCohesion: number;
    emotionalVariety: number;
    ctaEffectiveness: number;
    patternInterrupt: number;
    payoffSatisfaction: number;
  };
}

export interface EmotionalArc {
  dominant: string;
  trajectory: EmotionalPoint[];
  variety: number;
  primaryEmotion: string;
  secondaryEmotion: string;
}

export interface EmotionalPoint {
  position: number;
  emotion: string;
  intensity: number;
}

export interface ContentInsightType {
  id?: string;
  category: InsightCategory;
  content: string;
  source: InsightSource;
  confidence: number;
  applicationCount: number;
  lastAppliedAt?: string;
  createdAt?: string;
}

export type InsightCategory =
  | 'hook'
  | 'structure'
  | 'pacing'
  | 'cta'
  | 'emotional'
  | 'retention'
  | 'storytelling'
  | 'thumbnail'
  | 'general';

export type InsightSource =
  | 'transcript-analysis'
  | 'performance-correlation'
  | 'ai-recommendation'
  | 'manual';

export interface TranscriptIntelligenceResult {
  projectId: string;
  transcriptText: string;
  language: string;
  detectedHooks: DetectedHook[];
  hookScore: number;
  hookRecommendations: string[];
  hookQuality: HookQualityScore;
  retentionLoops: RetentionLoop[];
  patternInterrupts: PatternInterrupt[];
  storytellingStructure: StorytellingStructure | null;
  narrativeArcScore: number;
  pacingPattern: PacingPattern | null;
  pacingScore: number;
  engagementScore: EngagementScore;
  viralPotentialScore: number;
  detectedCTAs: string[];
  ctaEffectiveness: number;
  emotionalArc: EmotionalArc | null;
  insights: ContentInsightType[];
  sourceVideoIds: string[];
}

// ─── Analytics Learning Types ─────────────────────

export interface AnalyticsLearningResult {
  projectId: string;
  hookRetentionScore: number;
  hookEffectiveness: HookEffectivenessEntry[];
  thumbnailScore: number;
  thumbnailStyle: string;
  dropOffPoints: DropOffPoint[];
  retentionCurve: RetentionCurvePoint[];
  recommendations: OptimizationRecommendation[];
  learningIteration: number;
  confidence: number;
}

export interface HookEffectivenessEntry {
  hookType: string;
  avgRetention: number;
  sampleSize: number;
  confidence: number;
  score: number;
}

export interface DropOffPoint {
  position: number;
  severity: 'critical' | 'moderate' | 'minor';
  estimatedDropPercent: number;
  context: string;
  likelyCause: string;
}

export interface RetentionCurvePoint {
  position: number;
  retention: number;
  label: string;
}

export interface OptimizationRecommendation {
  category: 'hook' | 'thumbnail' | 'pacing' | 'structure' | 'cta' | 'retention' | 'general';
  priority: 'critical' | 'high' | 'medium' | 'low';
  content: string;
  expectedImpact: string;
  confidence: number;
  relatedMetric: string;
}

export interface ContentScore {
  hookScore: number;
  thumbnailCTR: number;
  retentionPrediction: number;
  engagementPrediction: number;
}

export interface ThumbnailCTRAnalysis {
  style: string;
  predictedCTR: number;
  actualCTR: number;
  impressions: number;
  clicks: number;
  performance: 'excellent' | 'good' | 'average' | 'poor';
  recommendations: string[];
}

export interface HookRetentionCorrelation {
  hookType: string;
  averageRetention: number;
  sampleSize: number;
  correlationStrength: number;
  isStatisticallySignificant: boolean;
}
