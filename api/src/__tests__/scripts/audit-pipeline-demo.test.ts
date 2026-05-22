/**
 * ═══════════════════════════════════════════════════════════════
 * AUDIT → OPTIMIZE PIPELINE DEMO
 *
 * Runs the full Channel Audit → Channel Optimization pipeline
 * end-to-end with realistic mock data.
 *
 * Run with: npx vitest run api/src/__tests__/scripts/audit-pipeline-demo.test.ts
 * ═══════════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════
// HOISTED HELPERS
// ═══════════════════════════════════════════════════════════════

const prismaMock = vi.hoisted(() => {
  const models = [
    'youTubeAccount', 'channelMetrics', 'videoProject', 'analytics',
    'uploadHistory', 'user', 'aIUsage',
  ];
  const methods = ['findUnique', 'findFirst', 'findMany', 'create', 'update', 'upsert', 'delete', 'count', 'aggregate'];
  const mock: Record<string, any> = {};
  for (const model of models) {
    mock[model] = {};
    for (const method of methods) {
      mock[model][method] = vi.fn();
    }
  }
  mock.$disconnect = vi.fn();
  mock.$connect = vi.fn();
  mock.$transaction = vi.fn();
  mock.$use = vi.fn();
  return mock;
});

const generateWithAIMock = vi.hoisted(() => vi.fn());

// ═══════════════════════════════════════════════════════════════
// MOCKS
// ═══════════════════════════════════════════════════════════════

vi.mock('../../config/db', () => ({
  prisma: prismaMock,
  disconnectDatabase: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  aiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  queueLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  pipelineLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../config/env', () => ({
  env: {
    PORT: 4000, NODE_ENV: 'test', JWT_SECRET: 'test-jwt-secret-min-32-chars-long-!!',
    GEMINI_API_KEY: '', OLLAMA_HOST: 'http://localhost:11434', OLLAMA_MODEL: 'llama3',
    YOUTUBE_CLIENT_ID: 'mock-client-id', YOUTUBE_CLIENT_SECRET: 'mock-client-secret',
    YOUTUBE_REFRESH_TOKEN: 'mock-refresh-token', YOUTUBE_API_KEY: 'mock-api-key',
    OAUTH_STATE_SECRET: 'mock-state-secret', ENCRYPTION_KEY: 'mock-encryption-key',
  },
}));

vi.mock('ioredis', () => {
  function MockIORedis() {
    return {
      on: vi.fn().mockReturnThis(), once: vi.fn().mockReturnThis(),
      connect: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue('OK'), ping: vi.fn().mockResolvedValue('PONG'),
      get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK'),
      setex: vi.fn().mockResolvedValue('OK'), incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1), status: 'ready',
    };
  }
  return { default: MockIORedis };
});

vi.mock('../../config/redis', () => ({
  redisConnection: {
    get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'), incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1), del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue('PONG'), quit: vi.fn().mockResolvedValue('OK'),
    status: 'ready', on: vi.fn().mockReturnThis(),
  },
  detectRedisVersion: vi.fn().mockResolvedValue(7),
  isRedisCompatible: vi.fn().mockReturnValue(true),
  disconnectRedis: vi.fn(),
}));

vi.mock('../../services/circuit-breaker.service', () => ({
  aiBreaker: vi.fn().mockReturnValue({
    call: vi.fn().mockImplementation((fn: Function) => fn()),
    status: 'closed', stats: { success: 0, failure: 0 },
  }),
}));

vi.mock('../../services/ai-usage.service', () => ({
  AIUsageService: {
    track: vi.fn(),
    checkDailyLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 100, limit: 100 }),
    getDailyUsage: vi.fn().mockResolvedValue({ count: 0, tokens: 0, cost: 0 }),
  },
}));

vi.mock('../../utils/prompt-sanitizer', () => ({
  sanitizePrompt: vi.fn().mockReturnValue({ sanitized: 'mock prompt', blocked: false }),
}));

vi.mock('../../utils/token-estimator', () => ({
  estimateTokens: vi.fn().mockReturnValue(100), estimateCost: vi.fn().mockReturnValue(0.001),
}));

vi.mock('../../services/ai.service', () => ({
  generateWithAI: generateWithAIMock,
}));

vi.mock('axios', () => ({
  default: {
    post: vi.fn(), get: vi.fn(), create: vi.fn().mockReturnThis(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

// ═══════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════

import { ChannelAuditService, type ChannelAuditReport } from '../../services/channel-audit.service';
import { ChannelOptimizerService, type OptimizationOutput } from '../../services/channel-optimizer.service';

// ═══════════════════════════════════════════════════════════════
// COLOR CODES & HELPERS
// ═══════════════════════════════════════════════════════════════

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m',
  yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
  red: '\x1b[31m', white: '\x1b[37m', black: '\x1b[30m',
  bgBlue: '\x1b[44m', bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m', bgYellow: '\x1b[43m',
};

function colorBar(value: number, max: number): string {
  const filled = Math.round((value / max) * 20);
  const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, 20 - filled));
  const color = value >= 70 ? C.green : value >= 40 ? C.yellow : C.red;
  return `${color}${bar}${C.reset} ${C.bold}${value}${C.reset}`;
}

function statusEmoji(score: number): string {
  if (score >= 80) return '🟢';
  if (score >= 60) return '🟡';
  if (score >= 40) return '🟠';
  return '🔴';
}

function section(title: string, content: string, color = C.cyan) {
  console.log(`\n${color}${C.bold}┌─ ${title}${C.reset}`);
  const lines = content.split('\n');
  for (const line of lines) {
    console.log(`${color}│${C.reset} ${line}`);
  }
  console.log(`${color}└${'─'.repeat(50)}${C.reset}`);
}

function listSection(title: string, items: string[], color = C.magenta) {
  console.log(`\n${color}${C.bold}┌─ ${title}${C.reset}`);
  for (const item of items) {
    console.log(`${color}│${C.reset} ${C.dim}•${C.reset} ${item}`);
  }
  console.log(`${color}└${'─'.repeat(50)}${C.reset}`);
}

function divider() {
  console.log(`\n${C.dim}${'═'.repeat(60)}${C.reset}`);
}

// ═══════════════════════════════════════════════════════════════
// MOCK DATA HELPERS
// ═══════════════════════════════════════════════════════════════

function mockChannelAccount(overrides: Record<string, any> = {}) {
  return {
    id: 'yt-acc-demo-1', userId: 'user-demo-1',
    channelId: 'UC-PsychologicalHorror', channelTitle: 'CreepyVault',
    channelAvatar: 'https://yt3.googleusercontent.com/demo-avatar',
    isConnected: true, niche: 'Entertainment',
    accessToken: 'mock-token', refreshToken: 'mock-refresh',
    tokenExpiresAt: new Date(Date.now() + 3600000),
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  };
}

function mockChannelMetrics(overrides: Record<string, any> = {}) {
  return {
    id: 'metrics-demo-1', channelId: 'UC-PsychologicalHorror',
    subscribers: 3420, totalViews: 189000, totalVideos: 47,
    avgCTR: 4.2, avgRetention: 32.8, subscriberGrowth: 85,
    monthlyViews: 12400, monthlyWatchHours: 890,
    estimatedRPM: 3.75, estimatedCPM: 1.95, estimatedEarnings: 46.50,
    topNiche: 'Horror Fans & Mystery Enthusiasts', ...overrides,
  };
}

function mockVideoProject(idx: number, overrides: Record<string, any> = {}) {
  const views = [8500, 23400, 5600, 42000, 3100, 18200, 9800, 6700, 15100, 28900];
  const ctrs = [5.2, 8.1, 3.8, 10.4, 2.9, 6.7, 4.5, 3.6, 5.8, 7.3];
  const rets = [38, 52, 25, 61, 18, 44, 35, 28, 41, 48];
  return {
    id: `video-project-${idx}`, userId: 'user-demo-1',
    channelId: 'UC-PsychologicalHorror',
    topic: `Horror Video ${idx}`,
    title: [
      'The SCARIEST CCTV Footage Ever Caught on Camera',
      'I Spent 24 Hours in an Abandoned Asylum (NOT What I Expected)',
      'The Creepiest Coincidence in Internet History',
      'This YouTube Video Will HAUNT You Forever',
      '3 AM Challenge Gone WRONG (REAL Footage)',
      'The Nightmare Next Door: A True Story',
      '5 Disturbing Subreddits You Should NEVER Visit',
      'The Vanishing of [REDACTED] — Unsolved Mystery',
      'AI Generated This Horror Story and It\'s TERRIFYING',
      'The Last Known Photo Before They Disappeared',
    ][idx - 1] || `Psychological Horror ${idx}`,
    status: 'published',
    createdAt: new Date(Date.now() - idx * 86400000 * 3),
    updatedAt: new Date(),
    analytics: {
      id: `analytics-${idx}`, projectId: `video-project-${idx}`,
      views: views[idx - 1] || 10000,
      likes: Math.round((views[idx - 1] || 10000) * 0.06),
      comments: Math.round((views[idx - 1] || 10000) * 0.012),
      ctr: ctrs[idx - 1] || 5.0,
      retention: rets[idx - 1] || 35,
      watchTime: (views[idx - 1] || 10000) * 60 * 0.4,
    },
    uploadHistory: {
      id: `uh-${idx}`, projectId: `video-project-${idx}`,
      videoId: `yt-video-${idx}`, status: 'uploaded',
      publishedAt: new Date(Date.now() - idx * 86400000 * 3),
    },
    ...overrides,
  };
}

/**
 * Simulated AI-generated audit report.
 * Represents a mid-tier horror channel with clear issues.
 */
const SIMULATED_AUDIT: ChannelAuditReport = {
  niche_analysis: {
    actualNiche: 'Horror Entertainment (Psychological / True Crime / Mystery)',
    expectedNiche: 'Psychological Horror',
    matchScore: 62,
    mismatchReasons: [
      'Channel mixes true crime, ghost stories, and creepy internet content — dilutes niche clarity',
      'No clear distinction between scripted horror and real paranormal content',
      'Target audience (horror fans) mismatches with thumbnail style (more clickbaity than atmospheric)',
    ],
    nicheClarityLevel: 'Mixed',
  },
  branding: {
    brandingScore: 38,
    issues: [
      'Channel name "CreepyVault" is generic and overused in the horror niche',
      'Banner lacks a clear value proposition — no schedule, no brand tagline',
      'Logo is a generic spooky font text — no visual identity',
      'No consistent color palette across channel art',
      'Branding does not differentiate from thousands of similar horror channels',
    ],
    emotionalImpactLevel: 'Low',
  },
  seo: {
    seoScore: 41,
    missingKeywords: [
      'psychological horror explained',
      'disturbing videos breakdown',
      'creepy internet mysteries',
      'true scary stories narration',
      'horror analysis commentary',
    ],
    keywordOpportunities: [
      'disturbing internet history',
      'scary iceberg explained',
      'creepy unsolved mysteries 2026',
      'psychological horror documentary',
      'dark web stories (with disclaimer)',
    ],
  },
  content_strategy: {
    contentStrategyScore: 52,
    viralPotentialRating: 'Medium — some breakout hits (42K views) but high inconsistency',
    contentGaps: [
      'No series or recurring format (every video is one-off)',
      'No shorts / vertical content strategy despite being Shorts-focused',
      'No playlist organization',
      'Missing call-to-action in 60% of videos',
      'Upload schedule is erratic (2-14 days between uploads)',
    ],
  },
  ctr_retention: {
    ctrScore: 45,
    retentionScore: 41,
    keyDropOffRisks: [
      'First 10 seconds lack hook — slow atmospheric intros hurt retention',
      'Thumbnails inconsistent — some are high quality, others are dark/unreadable',
      'Middle-section pacing too slow in 70% of videos',
      'Title curiosity gap is weak on underperforming videos',
    ],
  },
  competitor_analysis: {
    weaknessVsCompetitors: [
      'Competitors upload 3x more frequently',
      'Competitors use face cam reactions which boost retention',
      'Competitors have branded series (e.g., "Nightmare Files")',
      'Better thumbnail design with consistent text overlay',
    ],
    opportunitiesToOutperform: [
      'Psychological analysis angle is underexplored by competitors',
      'Deeper research/educational horror content has higher CPM',
      'No one in niche is using AI-assisted storytelling effectively',
      'Commentary + analysis format performs well but is underutilized',
    ],
  },
  action_plan: {
    quick_fixes: [
      'Add channel trailer explaining what the channel offers',
      'Organize existing videos into themed playlists',
      'Add end screens and subscribe CTAs to all videos',
      'Update channel description with niche keywords',
    ],
    high_impact_fixes: [
      'Rebrand to a more distinct channel name',
      'Create a signature series format (e.g., "The Horror Vault: Episode X")',
      'Redesign thumbnail template with consistent typography',
      'Implement face cam reactions for retention boost',
    ],
    long_term_strategy: [
      'Transition to psychological horror analysis niche (higher CPM, less competition)',
      'Build a weekly series to establish schedule consistency',
      'Collaborate with complementary channels (mystery, true crime)',
      'Create a branded membership with exclusive horror analysis content',
    ],
    suggestedDescription: 'Welcome to CreepyVault — where we explore the darkest corners of the internet, unsolved mysteries, and psychological horror. Every week, we bring you disturbing stories that will keep you up at night.\n\n🔔 Subscribe for weekly horror content\n👻 New videos every Friday\n💀 Join 3,400+ brave souls in the comments',
    suggestedTags: ['horror', 'creepy stories', 'true horror', 'scary videos', 'psychological horror', 'unsolved mysteries', 'disturbing', 'creepypasta', 'paranormal', 'mystery'],
    suggestedChannelName: 'The Horror Vault',
    bannerTextSuggestion: 'Headline: "Every Corner Has a Story" | Subheadline: "Psychological Horror & Unsolved Mysteries — Weekly"',
    logoConceptSuggestion: 'Minimalist eye within a geometric triangle, using deep purple (#4C1D95) and blood orange (#DC2626) gradient',
  },
  final_score: 41,
  summary: 'CreepyVault has potential but suffers from generic branding, inconsistent quality, and a confused niche identity. The channel performs best on mystery/analysis videos (42K views) but fails to replicate that success. Immediate rebranding to a more distinct identity and transition to psychological horror analysis is recommended for 5-10x growth.',
};

/**
 * Simulated AI-generated optimization output.
 */
const SIMULATED_OPTIMIZATION: OptimizationOutput = {
  niche_positioning:
    'The Horror Vault — the most immersive psychological horror analysis channel on YouTube. ' +
    'We dissect the internet\'s darkest corners, unsolved mysteries, and brain-bending horror ' +
    'stories that make you question reality. Not just scary — thought-provoking.',
  optimized_description:
    '🧠 YOUR MIND WILL NEVER BE THE SAME.\n\n' +
    'The Horror Vault is NOT just another creepy channel. We dive DEEP into the psychology ' +
    'behind the world\'s most disturbing stories, unsolved mysteries, and internet rabbit holes ' +
    'that will rewire your brain.\n\n' +
    '🔥 What you\'ll find here:\n' +
    '• Psychological horror analysis that goes beyond surface-level scares\n' +
    '• Disturbing internet mysteries with full breakdowns\n' +
    '• True crime cases with psychological perspectives\n' +
    '• Original horror stories designed to make you think\n\n' +
    '📅 New video every Friday at 7PM EST\n' +
    '🔔 SUBSCRIBE or the shadow man wins\n' +
    '💬 Join 3,400+ horror enthusiasts in the abyss',
  optimized_tags: [
    'psychological horror', 'horror analysis', 'creepy internet stories',
    'unsolved mysteries', 'disturbing videos explained', 'true horror stories',
    'creepypasta explained', 'dark web stories', 'scary iceberg explained',
    'mystery breakdown', 'horror documentary', 'psychological thriller',
    'disturbing internet history', 'nightmare fuel', 'creepy reddit stories',
    'paranormal investigation', 'scary mysteries', 'brain horror',
    'existential horror', 'horror storytelling', 'dark psychology',
    'fear analysis', 'creepy coincidences', 'missing persons cases',
    'disturbing discoveries', 'psychological analysis', 'scary narrations',
    'horror commentary', 'creepy facts', 'mind bending stories',
  ],
  name_suggestions: [
    'The Horror Vault',
    'MindShaft',
    'The Nightmare Institute',
    'Depth Perception',
    'Echoes of Fear',
  ],
  banner_text: {
    headline: 'Every Corner Has a Story',
    subheadline: 'Psychological Horror & Unsolved Mysteries — New Videos Every Friday',
  },
  logo_concept:
    'A minimalist geometric design featuring a stylized eye within an inverted triangle — ' +
    'symbolizing perception, surveillance, and hidden truths. Color palette: deep purple ' +
    '(#4C1D95) for mystery, blood orange (#DC2626) for danger, and off-white (#F5F5F5) ' +
    'for contrast. Clean, bold, and instantly recognizable even at small sizes. ' +
    'The eye should have a subtle glint suggesting awareness — "something is watching."',
  viral_video_ideas: [
    'I Analyzed 100 Horror Games in 10 Minutes (The Results Are Disturbing)',
    'The Hidden Message in [Famous Horror Movie] That NO ONE Noticed',
    'This Reddit Thread Predicted a Real Crime (FULL Timeline)',
    'I Explored the Deepest Layers of the Internet (What I Found Will Haunt You)',
    'The Psychological Trick Horror Movies Use to Control Your Brain',
    '5 Disturbing Iceberg Layers That Will Ruin Your Night',
    'I Found a Secret Subreddit That Knows Too Much',
    'The Science of Fear: Why Your Brain Loves Being Terrified',
    'This Creepypasta Was BANNED From the Internet (FULL Story)',
    'Your Biggest Fear Is Actually [Psychological Truth] — Explained',
    'The Most Disturbing Wikipedia Article I\'ve Ever Read',
    'I Spent 30 Days in Horror Communities — Here\'s What I Learned about Human Nature',
  ],
  seo_boost: {
    keywordsToTarget: [
      'psychological horror explained',
      'disturbing internet mysteries 2026',
      'horror analysis commentary',
      'creepy reddit stories explained',
      'unsolved mysteries documentary style',
      'scary narrations with analysis',
      'horror iceberg explained',
      'dark psychology horror',
    ],
    hashtagStrategy:
      '3 high-volume + 2 niche tags per video. Primary: #PsychologicalHorror #HorrorAnalysis ' +
      '#DisturbingMysteries. Niche: #MindShaft (branded), #HorrorVault (branded). ' +
      'Place branded tags in the first comment to keep description clean. ' +
      'Avoid #fyp #viral #scary (too generic, low conversion).',
  },
  monetization_plan:
    '1) AFFILIATE: Partner with Audible (audiobooks on horror/mystery) and horror-themed ' +
    'merch (creepy apparel, occult decor). Promote in description with curated horror book lists.\n' +
    '2) SPONSORSHIPS: Target VPNs (Nord, ExpressVPN — "protect your digital footprint"), ' +
    'horror streaming services (Shudder, Screambox), and dark tourism experiences.\n' +
    '3) MEMBERSHIPS: Channel memberships at $4.99/mo for exclusive "deeper dive" analysis ' +
    'videos, early access, and members-only community posts.\n' +
    '4) MERCH: Minimalist horror-branded apparel (hoodies with the eye logo, subtle designs ' +
    'that horror fans would wear publicly). Use Print-on-demand (Printful) for zero inventory risk.\n' +
    '5) COURSES: "The Art of Horror Storytelling" — sell a video course on writing/distribution ' +
    'of horror content. Target 1,000 students at $47 = $47K passive.\n' +
    '6) SUPER THANKS / SUPER CHAT: Encourage during premieres with countdown rituals.',
  transformation_summary:
    'Complete channel transformation from "CreepyVault" (generic, score 41) to "The Horror Vault" ' +
    '(distinct, high-CTR psychological horror brand). 30 hyper-targeted tags replacing 5 generic ones. ' +
    '12 viral video ideas with psychological hooks. SEO keyword strategy targeting high-CPM ' +
    'psychological horror analysis niche. Multi-stream monetization plan. Estimated improvement: ' +
    '2-3x CTR increase, 40%+ retention improvement, 5-10x channel growth within 6 months.',
  confidence_score: 84,
  before_vs_after: {
    whatWasWrong: [
      'Channel name "CreepyVault" is generic and forgettable',
      'No clear niche — mixes true crime, ghost stories, and creepypasta without focus',
      'Branding scores only 38/100 — no visual identity, inconsistent thumbnails',
      'CTR at 4.2% — well below the 7-10% benchmark for horror niche',
      'Retention at 32.8% — first 10 seconds have no hook',
      'SEO score 41/100 — missing critical keywords, only 5 weak tags',
      'No series or consistent format — every video is a one-off',
      'No monetization strategy beyond AdSense',
    ],
    whatIsFixed: [
      'Rebranded to "The Horror Vault" — distinctive, memorable, niche-aligned',
      'Niche narrowed to "psychological horror analysis" — higher CPM, less competition',
      'Logo concept: minimalist eye-in-triangle with deep purple/blood orange palette',
      'Banner text: "Every Corner Has a Story" with clear upload schedule',
      'SEO-optimized description with psychological hooks and keywords',
      '30 hyper-targeted high-ranking tags generated',
      '12 viral video ideas with CTR-optimized titles using curiosity gaps',
      'Multi-stream monetization plan: affiliate, sponsorships, merch, memberships, courses',
      'Weekly upload schedule commitment (Fridays at 7PM EST)',
    ],
    expectedImprovement:
      '🚀 CTR improvement: 4.2% → 8-10% (2.4x uplift through better thumbnails and titles)\n' +
      '🚀 Retention improvement: 32.8% → 50-55% (faster hooks, face cam reactions)\n' +
      '🚀 Subscriber growth: 85/mo → 300-500/mo (consistent schedule + branded series)\n' +
      '🚀 Monthly views: 12.4K → 50-80K (viral video strategy + SEO)\n' +
      '🚀 Revenue: $46/mo → $500-1,000/mo (multi-stream monetization)\n' +
      '🚀 Brand differentiation: Generic → Top 3% distinctive horror brand within niche',
  },
};

// ═══════════════════════════════════════════════════════════════
// DEMO TEST
// ═══════════════════════════════════════════════════════════════

describe('🎬 Audit → Optimize Pipeline Demo', () => {
  let auditService: ChannelAuditService;
  let optimizerService: ChannelOptimizerService;

  beforeEach(() => {
    vi.clearAllMocks();
    auditService = new ChannelAuditService();
    optimizerService = new ChannelOptimizerService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the FULL pipeline: Audit → Optimize → Display Results', async () => {
    // ═══════════════════════════════════════════════════════
    // PHASE 1: CHANNEL AUDIT
    // ═══════════════════════════════════════════════════════

    console.log(`\n\n${C.bgBlue}${C.bold}${C.white}                              ${C.reset}`);
    console.log(`${C.bgBlue}${C.bold}${C.white}   PHASE 1: CHANNEL AUDIT 🕵️   ${C.reset}`);
    console.log(`${C.bgBlue}${C.bold}${C.white}                              ${C.reset}${C.reset}`);

    const channelAccount = mockChannelAccount();
    const channelMetrics = mockChannelMetrics();
    const topVideos = Array.from({ length: 10 }, (_, i) => mockVideoProject(i + 1));

    // Mock Prisma responses
    (prismaMock.youTubeAccount.findFirst as any).mockResolvedValue(channelAccount);
    (prismaMock.channelMetrics.findFirst as any).mockResolvedValue(channelMetrics);
    (prismaMock.videoProject.findMany as any).mockResolvedValue(topVideos);

    // Mock AI to return the simulated audit report
    generateWithAIMock.mockResolvedValueOnce(JSON.stringify(SIMULATED_AUDIT));

    console.log(`\n${C.dim}Analyzing channel:${C.reset} ${C.bold}${channelAccount.channelTitle}${C.reset} (${C.yellow}${channelAccount.channelId}${C.reset})`);
    console.log(`${C.dim}Expected niche:${C.reset} ${C.cyan}Psychological Horror${C.reset}`);
    console.log(`${C.dim}Videos analyzed:${C.reset} 10`);
    console.log(`${C.dim}Mock data:${C.reset} ${channelMetrics.subscribers.toLocaleString()} subscribers, ${channelMetrics.totalViews.toLocaleString()} total views${C.reset}\n`);

    const auditStart = Date.now();
    const auditReport = await auditService.runAudit({
      channelId: 'UC-PsychologicalHorror',
      expectedNiche: 'Psychological Horror',
    });
    const auditDuration = Date.now() - auditStart;

    // ── Display Audit Results ──

    divider();
    console.log(`\n${C.green}${C.bold}✅ AUDIT COMPLETE (${auditDuration}ms)${C.reset}`);

    // Overall score with big visual
    const healthEmoji = statusEmoji(auditReport.final_score);
    const healthLabel = auditReport.final_score >= 70 ? 'OPTIMIZED'
      : auditReport.final_score >= 40 ? 'NEEDS IMPROVEMENT'
      : 'CRITICAL ISSUES';
    console.log(`\n  ${healthEmoji} ${C.bold}OVERALL SCORE:${C.reset} ${colorBar(auditReport.final_score, 100)}  ${C.dim}(${healthLabel})${C.reset}`);

    // 7 Analysis Layers
    section('📊 NICHE ANALYSIS', [
      `Actual Niche:      ${C.bold}${auditReport.niche_analysis.actualNiche}${C.reset}`,
      `Expected Niche:    ${auditReport.niche_analysis.expectedNiche}`,
      `Match Score:       ${colorBar(auditReport.niche_analysis.matchScore, 100)}`,
      `Clarity Level:     ${auditReport.niche_analysis.nicheClarityLevel}`,
      `Mismatch Reasons:  ${auditReport.niche_analysis.mismatchReasons.map(r => `\n                     ${C.dim}•${C.reset} ${r}`).join('')}`,
    ].join('\n'), C.cyan);

    section('🎨 BRANDING', [
      `Branding Score:    ${colorBar(auditReport.branding.brandingScore, 100)}`,
      `Emotional Impact:  ${auditReport.branding.emotionalImpactLevel}`,
      `Issues:            ${auditReport.branding.issues.map(i => `\n                     ${C.dim}•${C.reset} ${i}`).join('')}`,
    ].join('\n'), C.magenta);

    section('🔍 SEO', [
      `SEO Score:         ${colorBar(auditReport.seo.seoScore, 100)}`,
      `Missing Keywords:  ${auditReport.seo.missingKeywords.map(k => `\n                     ${C.dim}•${C.reset} ${k}`).join('')}`,
    ].join('\n'), C.yellow);

    section('📝 CONTENT STRATEGY', [
      `Strategy Score:    ${colorBar(auditReport.content_strategy.contentStrategyScore, 100)}`,
      `Viral Potential:   ${auditReport.content_strategy.viralPotentialRating}`,
      `Content Gaps:      ${auditReport.content_strategy.contentGaps.map(g => `\n                     ${C.dim}•${C.reset} ${g}`).join('')}`,
    ].join('\n'), C.blue);

    section('🎯 CTR & RETENTION', [
      `CTR Score:         ${colorBar(auditReport.ctr_retention.ctrScore, 100)}`,
      `Retention Score:   ${colorBar(auditReport.ctr_retention.retentionScore, 100)}`,
      `Drop-Off Risks:    ${auditReport.ctr_retention.keyDropOffRisks.map(r => `\n                     ${C.dim}•${C.reset} ${r}`).join('')}`,
    ].join('\n'), C.red);

    section('🏆 COMPETITOR ANALYSIS', [
      `Weaknesses:        ${auditReport.competitor_analysis.weaknessVsCompetitors.map(w => `\n                     ${C.dim}•${C.reset} ${w}`).join('')}`,
      `Opportunities:     ${auditReport.competitor_analysis.opportunitiesToOutperform.map(o => `\n                     ${C.dim}•${C.reset} ${o}`).join('')}`,
    ].join('\n'), C.white);

    const quickFixLines = auditReport.action_plan.quick_fixes.map(f => `${C.green}${C.dim}🔥 Quick Fix:${C.reset} ${f}`);
    const highImpactLines = auditReport.action_plan.high_impact_fixes.map(f => `${C.yellow}${C.dim}💪 High-Impact:${C.reset} ${f}`);
    const longTermLines = auditReport.action_plan.long_term_strategy.map(s => `${C.blue}${C.dim}📈 Long-Term:${C.reset} ${s}`);
    listSection('⚡ ACTION PLAN', [...quickFixLines, ...highImpactLines, ...longTermLines], C.green);

    section('📋 SUMMARY', auditReport.summary, C.dim);

    // Determine execution mode
    const auditScore = auditReport.final_score;
    const mode = auditScore >= 60 ? 'FINE_TUNING'
      : auditScore >= 40 ? 'AGGRESSIVE_OPTIMIZATION'
      : auditScore >= 25 ? 'PARTIAL_REBRAND'
      : 'FULL_REBRAND';

    const modeColor = mode === 'FINE_TUNING' ? C.green
      : mode === 'AGGRESSIVE_OPTIMIZATION' ? C.yellow
      : mode === 'PARTIAL_REBRAND' ? C.magenta
      : C.red;

    console.log(`\n${modeColor}${C.bold}╔══════════════════════════════════════════════╗${C.reset}`);
    console.log(`${modeColor}${C.bold}║  EXECUTION MODE: ${mode.padEnd(33)}║${C.reset}`);
    console.log(`${modeColor}${C.bold}║  Score ${auditScore} → ${mode === 'FULL_REBRAND' ? '🔴 Full Rebrand' : mode === 'PARTIAL_REBRAND' ? '🟠 Partial Rebrand' : mode === 'AGGRESSIVE_OPTIMIZATION' ? '🟡 Aggressive Optimization' : '🟢 Fine Tuning'}${' '.repeat(18)}║${C.reset}`);
    console.log(`${modeColor}${C.bold}╚══════════════════════════════════════════════╝${C.reset}`);

    // ═══════════════════════════════════════════════════════
    // ASSERT: Audit completed successfully
    // ═══════════════════════════════════════════════════════
    expect(auditReport).toBeDefined();
    expect(auditReport.final_score).toBe(41);
    expect(auditReport.summary).toContain('CreepyVault');
    expect(auditReport.niche_analysis).toBeDefined();
    expect(auditReport.branding).toBeDefined();
    expect(auditReport.seo).toBeDefined();
    expect(auditReport.content_strategy).toBeDefined();
    expect(auditReport.ctr_retention).toBeDefined();
    expect(auditReport.competitor_analysis).toBeDefined();
    expect(auditReport.action_plan).toBeDefined();

    // ═══════════════════════════════════════════════════════
    // PHASE 2: CHANNEL OPTIMIZATION
    // ═══════════════════════════════════════════════════════

    console.log(`\n\n${C.bgGreen}${C.bold}${C.black}                             ${C.reset}`);
    console.log(`${C.bgGreen}${C.bold}${C.black}  PHASE 2: CHANNEL OPTIMIZATION 🚀  ${C.reset}`);
    console.log(`${C.bgGreen}${C.bold}${C.black}                             ${C.reset}${C.reset}`);

    // Mock AI to return the simulated optimization output
    generateWithAIMock.mockResolvedValueOnce(JSON.stringify(SIMULATED_OPTIMIZATION));

    console.log(`\n${C.dim}Running optimization for${C.reset} ${C.bold}${channelAccount.channelTitle}${C.reset} using audit report...\n`);

    const optStart = Date.now();
    const optResult = await optimizerService.runOptimization({
      auditReport,
      channelName: 'CreepyVault',
      channelDescription: 'Welcome to CreepyVault — where we explore the darkest corners of the internet.',
      channelTags: 'horror, creepy, scary, mystery, paranormal',
      channelBanner: 'https://yt3.googleusercontent.com/banner-dark-horror',
      channelLogo: 'https://yt3.googleusercontent.com/logo-creepyvault',
      targetNiche: 'Psychological Horror',
      targetAudience: 'Horror enthusiasts aged 18-34 who enjoy deep analysis and psychological themes',
    });
    const optDuration = Date.now() - optStart;

    // ── Display Optimization Results ──

    divider();
    console.log(`\n${C.green}${C.bold}✅ OPTIMIZATION COMPLETE (${optDuration}ms)${C.reset}`);

    // Confidence score
    const confEmoji = optResult.confidence_score >= 80 ? '🟢'
      : optResult.confidence_score >= 50 ? '🟡'
      : '🔴';
    console.log(`\n  ${confEmoji} ${C.bold}CONFIDENCE SCORE:${C.reset} ${colorBar(optResult.confidence_score, 100)}`);

    // 1. Niche Positioning
    section('🎯 NICHE POSITIONING', optResult.niche_positioning, C.cyan);

    // 2. Channel Description
    section('📝 OPTIMIZED DESCRIPTION', optResult.optimized_description, C.green);

    // 3. Tags
    const tags = optResult.optimized_tags.slice(0, 10);
    listSection(`🏷️ OPTIMIZED TAGS (${optResult.optimized_tags.length})`, tags, C.magenta);

    // 4. Name Suggestions
    listSection('💡 NAME SUGGESTIONS', optResult.name_suggestions, C.blue);

    // 5. Banner Text
    section('🖼️ BANNER TEXT', [
      `Headline:     ${C.bold}${optResult.banner_text.headline}${C.reset}`,
      `Subheadline:  ${optResult.banner_text.subheadline}`,
    ].join('\n'), C.yellow);

    // 6. Logo Concept
    section('🎨 LOGO CONCEPT', optResult.logo_concept, C.magenta);

    // 7. Viral Video Ideas
    listSection('🔥 VIRAL VIDEO IDEAS (12)', optResult.viral_video_ideas, C.white);

    // 8. SEO Boost
    section('🔍 SEO BOOST', [
      `${C.bold}Keywords to Target:${C.reset}`,
      ...optResult.seo_boost.keywordsToTarget.map(k => `  ${C.dim}•${C.reset} ${k}`),
      '',
      `${C.bold}Hashtag Strategy:${C.reset} ${optResult.seo_boost.hashtagStrategy}`,
    ].join('\n'), C.cyan);

    // 9. Monetization Plan
    section('💰 MONETIZATION PLAN', optResult.monetization_plan, C.green);

    // 10. Before vs After
    divider();
    console.log(`\n${C.bgRed}${C.bold}${C.white}     BEFORE     ${C.reset}      →      ${C.bgGreen}${C.bold}${C.black}     AFTER     ${C.reset}\n`);

    const bva = optResult.before_vs_after;
    const maxItems = Math.max(bva.whatWasWrong.length, bva.whatIsFixed.length);
    for (let i = 0; i < maxItems; i++) {
      const before = i < bva.whatWasWrong.length ? `✗ ${bva.whatWasWrong[i]}` : '';
      const after = i < bva.whatIsFixed.length ? `✓ ${bva.whatIsFixed[i]}` : '';
      if (before || after) {
        console.log(`  ${C.red}${before.padEnd(55)}${C.reset}  ${C.green}${after}${C.reset}`);
      }
    }

    // Expected Improvement
    section('📈 EXPECTED IMPROVEMENT', bva.expectedImprovement, C.green);

    // Transformation Summary
    section('📋 TRANSFORMATION SUMMARY', optResult.transformation_summary, C.dim);

    // ═══════════════════════════════════════════════════════
    // FINAL SUMMARY TABLE
    // ═══════════════════════════════════════════════════════

    divider();
    console.log(`\n${C.bgBlue}${C.bold}${C.white}          FINAL PIPELINE SUMMARY         ${C.reset}\n`);

    const pipelineTable = [
      ['Metric', 'Before', 'After', 'Improvement'],
      ['───────────────', '────────', '───────', '────────────'],
      ['Overall Score', '41/100', `${optResult.confidence_score}/100`, `+${optResult.confidence_score - 41} pts`],
      ['Branding', '38/100', 'N/A (see optimization)', 'Rebrand initiated'],
      ['SEO', '41/100', '30 tags + 8 keywords', 'Complete overhaul'],
      ['CTR (estimated)', '4.2%', '8-10%', '+3.8-5.8% 🚀'],
      ['Retention', '32.8%', '50-55%', '+17-22% 🚀'],
      ['Name', 'CreepyVault', 'The Horror Vault', 'Rebranded'],
      ['Upload Schedule', 'Erratic', 'Weekly (Friday)', 'Consistent'],
      ['Monetization', 'AdSense only', '6 streams', 'Multi-stream'],
    ];

    for (const row of pipelineTable) {
      const isHeader = row === pipelineTable[0] || row === pipelineTable[1];
      const color = isHeader ? C.bold : C.dim;
      console.log(`  ${color}${row[0].padEnd(22)}${C.reset} ${row[1].padEnd(10)} ${row[2].padEnd(12)} ${isHeader ? '' : C.green}${row[3]}${C.reset}`);
    }

    console.log(`\n${C.bold}Total pipeline time:${C.reset} ${auditDuration + optDuration}ms (Audit: ${auditDuration}ms + Optimize: ${optDuration}ms)`);
    console.log(`\n${C.green}${C.bold}✅ Pipeline completed successfully!${C.reset}`);

    // ═══════════════════════════════════════════════════════
    // ASSERT: Optimization completed successfully
    // ═══════════════════════════════════════════════════════
    expect(optResult).toBeDefined();
    expect(optResult.confidence_score).toBe(84);
    expect(optResult.niche_positioning).toContain('Horror Vault');
    expect(optResult.optimized_description).toContain('SUBSCRIBE');
    expect(optResult.optimized_tags.length).toBeGreaterThanOrEqual(15);
    expect(optResult.optimized_tags.length).toBeLessThanOrEqual(31);
    expect(optResult.name_suggestions.length).toBeGreaterThanOrEqual(1);
    expect(optResult.name_suggestions.length).toBeLessThanOrEqual(6);
    expect(optResult.banner_text.headline).toBeTruthy();
    expect(optResult.logo_concept).toBeTruthy();
    expect(optResult.viral_video_ideas.length).toBeGreaterThanOrEqual(5);
    expect(optResult.viral_video_ideas.length).toBeLessThanOrEqual(13);
    expect(optResult.seo_boost.keywordsToTarget.length).toBeGreaterThanOrEqual(1);
    expect(optResult.seo_boost.hashtagStrategy).toBeTruthy();
    expect(optResult.monetization_plan).toBeTruthy();
    expect(optResult.transformation_summary).toBeTruthy();
    expect(optResult.before_vs_after.whatWasWrong.length).toBeGreaterThanOrEqual(1);
    expect(optResult.before_vs_after.whatIsFixed.length).toBeGreaterThanOrEqual(1);
    expect(optResult.before_vs_after.expectedImprovement).toContain('CTR');

    // Verify generateWithAI was called exactly twice (once for audit, once for optimize)
    expect(generateWithAIMock).toHaveBeenCalledTimes(2);
  });
});
