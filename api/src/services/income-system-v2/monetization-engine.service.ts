import { prisma } from '../../config/db';
import { generateWithAI } from '../ai.service';
import type { IncomeVideoPlan } from './types';

const DEFAULT_CPM = 0.50;
const MAX_RETRIES = 3;

const AFFILIATE_TEMPLATES: Record<string, Array<{ product: string; url: string; placement: string }>> = {
  'tech': [
    { product: 'Best AI Tools Suite', url: 'https://example.com/ai-tools', placement: 'description' },
    { product: 'Top Tech Gadgets', url: 'https://example.com/tech-deals', placement: 'pinned-comment' },
  ],
  'finance': [
    { product: 'Trading Platform', url: 'https://example.com/trade', placement: 'description' },
    { product: 'Budgeting App', url: 'https://example.com/budget', placement: 'pinned-comment' },
  ],
  'education': [
    { product: 'Online Course Platform', url: 'https://example.com/courses', placement: 'description' },
    { product: 'Study Tools', url: 'https://example.com/study', placement: 'pinned-comment' },
  ],
};

const ENGAGEMENT_CTAS = [
  '👇 Which tip surprised you most? Comment below!',
  '🔥 Drop "MORE" if you want part 2 of this!',
  '💬 What would YOU add to this list? Let me know!',
  '👀 Watch till the end — the last tip is the most important.',
  '⚡ Share this with someone who needs to see it!',
];

function buildMonetizationPrompt(niche: string, topic: string, script: string): string {
  return `You are a YouTube monetization strategist for the "${niche}" niche.
Given the video topic "${topic}", generate aggressive but natural monetization.

Return ONLY valid JSON with this structure:
{
  "affiliateLinks": [
    { "product": "string with 2026 context", "url": "string starting with https://", "placement": "description|pinned-comment|end-screen" },
    { "product": "string", "url": "string", "placement": "string" }
  ],
  "ctaText": "Compelling CTA with emoji - MUST include an engagement question or action word",
  "ctaPlacement": "end|pinned-comment|both",
  "funnelType": "free-plus-shipping|low-ticket|high-ticket|awareness"
}

REQUIRED:
- At least 2 affiliate links with real-looking products relevant to ${topic}
- CTA must include an emoji and an engagement trigger (question or challenge)
- funnelType should be 'low-ticket' if product under $50, 'high-ticket' if over $100
- Every video is an opportunity — always include monetization`;
}

function fallbackMonetization(niche: string): IncomeVideoPlan['monetization'] {
  const nicheLinks = AFFILIATE_TEMPLATES[niche.toLowerCase()] || [
    { product: 'Recommended Tool', url: 'https://example.com/tool', placement: 'description' },
  ];
  return {
    affiliateLinks: nicheLinks,
    ctaText: ENGAGEMENT_CTAS[Math.floor(Math.random() * ENGAGEMENT_CTAS.length)],
    ctaPlacement: 'both',
    funnelType: 'awareness',
  };
}

export async function injectMonetization(
  videoPlan: IncomeVideoPlan,
): Promise<IncomeVideoPlan> {
  const prompt = buildMonetizationPrompt(
    videoPlan.topicScore.niche,
    videoPlan.topicScore.topic,
    (videoPlan.script || '').slice(0, 500),
  );

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const aiResponse = await generateWithAI(prompt, 'ollama', {
        temperature: 0.5,
        maxTokens: 600,
      });
      const parsed = JSON.parse(aiResponse);
      videoPlan.monetization = {
        affiliateLinks: Array.isArray(parsed.affiliateLinks) && parsed.affiliateLinks.length > 0
          ? parsed.affiliateLinks.slice(0, 3)
          : fallbackMonetization(videoPlan.topicScore.niche).affiliateLinks,
        ctaText: parsed.ctaText || ENGAGEMENT_CTAS[Math.floor(Math.random() * ENGAGEMENT_CTAS.length)],
        ctaPlacement: parsed.ctaPlacement || 'both',
        funnelType: parsed.funnelType || 'awareness',
      };
      break;
    } catch {
      if (attempt === MAX_RETRIES) {
        videoPlan.monetization = fallbackMonetization(videoPlan.topicScore.niche);
      }
    }
  }

  const cfg = await prisma.incomeConfig.findUnique({
    where: { channelId: videoPlan.channelId },
  });
  videoPlan.estimatedCpm = DEFAULT_CPM;
  videoPlan.estimatedRevenue = cfg?.niche
    ? DEFAULT_CPM * 0.5
    : DEFAULT_CPM * 0.3;

  return videoPlan;
}

export async function updateMonetizationResult(
  projectId: string,
  planJson: string,
): Promise<void> {
  try {
    const plan: IncomeVideoPlan = JSON.parse(planJson);
    await prisma.incomeVideoOutput.update({
      where: { projectId },
      data: {
        affiliateLinks: JSON.stringify(plan.monetization.affiliateLinks),
        ctaText: plan.monetization.ctaText,
        ctaPlacement: plan.monetization.ctaPlacement,
        funnelType: plan.monetization.funnelType,
        estimatedCpm: plan.estimatedCpm,
        estimatedRevenue: plan.estimatedRevenue,
      },
    });
  } catch {
    // Non-critical — monetization updates are best-effort
  }
}
