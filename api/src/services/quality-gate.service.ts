import { prisma } from '../config/db';
import { logger } from '../utils/logger';

interface QualityCheck {
  name: string;
  score: number;
  threshold: number;
  passed: boolean;
  details: string;
}

interface QualityGateResult {
  passed: boolean;
  overallScore: number;
  checks: QualityCheck[];
  autoFixed: boolean;
}

const COPYRIGHT_BLACKLIST = [
  'nintendo', 'marvel', 'disney', 'star wars', 'harry potter', 'pokemon',
  'minecraft', 'fortnite', 'nike', 'adidas', 'apple', 'netflix',
  'stranger things', 'squid game', 'game of thrones', 'lord of the rings',
  'batman', 'superman', 'spider-man', 'avengers', 'jurassic park',
  'harry styles', 'taylor swift', 'beyonce', 'the beatles', 'michael jackson',
  'peppa pig', 'paw patrol', 'frozen', 'encanto', 'moana',
];

const PROFANITY_LIST = [
  'fuck', 'shit', 'ass', 'bitch', 'damn', 'bastard', 'crap',
  'dick', 'piss', 'slut', 'whore', 'cock', 'cunt',
];

const MONETIZABLE_KEYWORDS = [
  'review', 'tutorial', 'how to', 'guide', 'tips', 'tricks',
  'comparison', 'best', 'top', 'vs', 'vs.', 'test', 'review',
  'unboxing', 'setup', 'walkthrough', 'explained', 'complete',
];

const POWER_WORDS = [
  'amazing', 'incredible', 'shocking', 'best', 'ultimate', 'essential',
  'secret', 'hidden', 'revealed', 'exclusive', 'proven', 'guaranteed',
  'free', 'easy', 'simple', 'fast', 'powerful', 'effective',
  'you', 'your', 'why', 'how', 'what', 'never', 'always',
  'top', 'worst', 'biggest', 'greatest', 'perfect', 'simple',
];

export class QualityGateService {
  private readonly MIN_SCRIPT_QUALITY = 60;
  private readonly MIN_RETENTION = 40;
  private readonly MIN_COPYRIGHT = 50;
  private readonly MIN_MONETIZATION = 50;
  private readonly MIN_ENGAGEMENT = 40;
  private readonly OVERALL_MIN = 55;

  async evaluate(projectId: string): Promise<QualityGateResult> {
    logger.info(`Quality gate evaluation started for project ${projectId}`);

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        script: true,
        uploadHistory: true,
      },
    });

    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const scriptContent = project.script?.content ?? '';
    const title = project.title ?? project.topic;
    const description = project.description ?? '';
    const category = project.uploadHistory?.category ?? '';

    const scriptQuality = this.evaluateScriptQuality(scriptContent);
    const retention = this.evaluateRetentionPrediction(scriptContent);
    const copyright = this.evaluateCopyrightRisk(scriptContent, title, project.topic);
    const monetization = this.evaluateMonetizationEligibility(scriptContent, title, description, category);
    const engagement = this.evaluateEngagementPrediction(scriptContent, title);

    const checks: QualityCheck[] = [
      scriptQuality,
      retention,
      copyright,
      monetization,
      engagement,
    ];

    const overallScore = Math.round(
      checks.reduce((sum, c) => sum + c.score, 0) / checks.length,
    );

    const passed = overallScore >= this.OVERALL_MIN && checks.every(c => c.passed);

    logger.info(`Quality gate result for ${projectId}: ${passed ? 'PASS' : 'FAIL'} (${overallScore})`);

    return {
      passed,
      overallScore,
      checks,
      autoFixed: false,
    };
  }

  async autoFix(projectId: string): Promise<QualityGateResult> {
    logger.info(`Quality gate auto-fix started for project ${projectId}`);

    const result = await this.evaluate(projectId);

    if (result.passed) {
      return result;
    }

    let autoFixed = false;

    for (const check of result.checks) {
      if (check.passed) continue;

      if (check.name === 'Script Quality' && check.score < this.MIN_SCRIPT_QUALITY) {
        const project = await prisma.videoProject.findUnique({
          where: { id: projectId },
          include: { script: true },
        });

        if (project?.script) {
          let fixedContent = project.script.content;

          if (fixedContent.length < 200) {
            fixedContent = fixedContent + '\n\n' + this.generateExpandedContent(project.topic);
          }

          if (fixedContent.split('---SCENE---').length < 3) {
            fixedContent = fixedContent + '\n\n---SCENE---\n' + this.generateSceneContent(project.topic);
          }

          const lines = fixedContent.split('\n').filter(l => l.trim());
          const firstLine = lines[0]?.trim() ?? '';
          if (!this.isEngagingHook(firstLine)) {
            fixedContent = this.generateHook(project.topic) + '\n\n' + fixedContent;
          }

          const prevWordCount = project.script.wordCount;
          await prisma.script.update({
            where: { projectId },
            data: {
              content: fixedContent,
              wordCount: prevWordCount ? prevWordCount + 50 : fixedContent.split(/\s+/).length,
            },
          });

          autoFixed = true;
        }
      }

      if (check.name === 'Copyright Risk' && check.score < this.MIN_COPYRIGHT) {
        const project = await prisma.videoProject.findUnique({
          where: { id: projectId },
        });

        if (project) {
          const cleanTitle = this.removeCopyrightedTerms(project.title ?? project.topic);
          await prisma.videoProject.update({
            where: { id: projectId },
            data: { title: cleanTitle },
          });
          autoFixed = true;
        }
      }

      if (check.name === 'Engagement Prediction' && check.score < this.MIN_ENGAGEMENT) {
        const project = await prisma.videoProject.findUnique({
          where: { id: projectId },
        });

        if (project) {
          const newTitle = this.generateClickableTitle(project.topic);
          await prisma.videoProject.update({
            where: { id: projectId },
            data: { title: newTitle },
          });
          autoFixed = true;
        }
      }
    }

    const reResult = await this.evaluate(projectId);
    reResult.autoFixed = autoFixed;

    return reResult;
  }

  private evaluateScriptQuality(script: string): QualityCheck {
    let score = 0;
    const details: string[] = [];

    if (script.length >= 200) {
      score += 40;
      details.push('Script length sufficient');
    } else {
      details.push(`Script too short (${script.length}/200 chars)`);
    }

    const sceneCount = (script.match(/---SCENE---/g) ?? []).length;
    if (sceneCount >= 3) {
      score += 30;
      details.push(`Scene count adequate (${sceneCount})`);
    } else {
      details.push(`Too few scenes (${sceneCount}/3)`);
    }

    const lines = script.split('\n').filter(l => l.trim());
    const firstLine = lines[0]?.trim() ?? '';
    if (this.isEngagingHook(firstLine)) {
      score += 30;
      details.push('Hook detected in first line');
    } else {
      details.push('Missing engaging hook');
    }

    return {
      name: 'Script Quality',
      score,
      threshold: this.MIN_SCRIPT_QUALITY,
      passed: score >= this.MIN_SCRIPT_QUALITY,
      details: details.join('; '),
    };
  }

  private evaluateRetentionPrediction(script: string): QualityCheck {
    let score = 20;
    const details: string[] = [];

    const words = script.split(/\s+/).filter(w => w.length > 0).length;
    const sentences = script.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
    const scenes = script.split('---SCENE---');

    const estimatedDuration = words / 2.5;
    const wps = estimatedDuration > 0 ? words / estimatedDuration : 0;

    if (wps >= 2.0 && wps <= 3.5) {
      score += 30;
      details.push(`Pacing optimal (${wps.toFixed(1)} wps)`);
    } else if (wps > 0) {
      score += 10;
      details.push(`Pacing suboptimal (${wps.toFixed(1)} wps)`);
    }

    const durations = scenes.map(s => {
      const text = s.trim();
      return text ? Math.max(5, Math.min(20, text.split(/\s+/).length * 0.4)) : 0;
    }).filter(d => d > 0);

    if (durations.length > 1) {
      const unique = new Set(durations.map(d => Math.round(d)));
      const varietyRatio = unique.size / durations.length;
      if (varietyRatio >= 0.5) {
        score += 25;
        details.push('Good scene duration variety');
      } else if (varietyRatio >= 0.3) {
        score += 10;
        details.push('Moderate scene duration variety');
      } else {
        details.push('Scene durations too uniform');
      }
    }

    const scriptLower = script.toLowerCase();
    if (scriptLower.includes('?')) {
      score += 15;
      details.push('Hook question present');
    }
    if (/you|your|you're/i.test(script.substring(0, 200))) {
      score += 10;
      details.push('Second-person address in hook');
    }

    return {
      name: 'Retention Prediction',
      score: Math.min(100, score),
      threshold: this.MIN_RETENTION,
      passed: score >= this.MIN_RETENTION,
      details: details.join('; '),
    };
  }

  private evaluateCopyrightRisk(script: string, title: string, topic: string): QualityCheck {
    let score = 60;
    const details: string[] = [];

    const combined = `${title} ${topic} ${script}`.toLowerCase();

    const foundBlacklisted = COPYRIGHT_BLACKLIST.filter(term =>
      combined.includes(term.toLowerCase()),
    );

    if (foundBlacklisted.length > 0) {
      score -= foundBlacklisted.length * 15;
      details.push(`Blacklisted terms found: ${foundBlacklisted.join(', ')}`);
    } else {
      score += 20;
      details.push('No blacklisted copyright terms');
    }

    score = Math.max(0, Math.min(100, score));

    return {
      name: 'Copyright Risk',
      score,
      threshold: this.MIN_COPYRIGHT,
      passed: score >= this.MIN_COPYRIGHT,
      details: details.join('; '),
    };
  }

  private evaluateMonetizationEligibility(
    script: string,
    title: string,
    description: string,
    category: string,
  ): QualityCheck {
    let score = 30;
    const details: string[] = [];

    const combined = `${title} ${description} ${script}`.toLowerCase();

    const foundProfanity = PROFANITY_LIST.filter(word =>
      combined.includes(word),
    );

    if (foundProfanity.length > 0) {
      score -= foundProfanity.length * 20;
      details.push(`Profanity detected: ${foundProfanity.join(', ')}`);
    } else {
      score += 20;
      details.push('Advertiser-friendly content');
    }

    const foundKeywords = MONETIZABLE_KEYWORDS.filter(kw =>
      combined.includes(kw),
    );

    if (foundKeywords.length >= 2) {
      score += 20;
      details.push(`Monetizable keywords found (${foundKeywords.length})`);
    } else if (foundKeywords.length === 1) {
      score += 10;
      details.push('Few monetizable keywords');
    } else {
      details.push('No monetizable keywords');
    }

    const friendlyCategories = ['education', 'entertainment', 'howto', 'science', 'technology', 'gaming', 'music'];
    if (category && friendlyCategories.some(fc => category.toLowerCase().includes(fc))) {
      score += 15;
      details.push('Monetization-friendly category');
    } else if (!category) {
      score += 0;
    } else {
      details.push('Category may have monetization restrictions');
    }

    return {
      name: 'Monetization Eligibility',
      score: Math.min(100, Math.max(0, score)),
      threshold: this.MIN_MONETIZATION,
      passed: score >= this.MIN_MONETIZATION,
      details: details.join('; '),
    };
  }

  private evaluateEngagementPrediction(script: string, title: string): QualityCheck {
    let score = 20;
    const details: string[] = [];

    const scriptLower = script.toLowerCase();
    if (/subscribe|like|comment|share|follow|hit that|check out|link below|ring the bell/i.test(scriptLower)) {
      score += 25;
      details.push('CTA detected');
    } else {
      details.push('No CTA detected');
    }

    const firstTwentyPct = script.substring(0, Math.max(200, Math.floor(script.length * 0.2)));
    const hookIndicators = /\?|you|your|ever wondered|imagine|what if|did you know|here's why|the truth|secret|shocking|incredible|worst|best/i;
    if (hookIndicators.test(firstTwentyPct)) {
      score += 25;
      details.push('Engagement hook in opening');
    } else {
      details.push('Weak opening hook');
    }

    const titleScore = this.scoreTitleClickability(title);
    score += titleScore;
    details.push(`Title clickability: ${titleScore}/30`);

    return {
      name: 'Engagement Prediction',
      score: Math.min(100, score),
      threshold: this.MIN_ENGAGEMENT,
      passed: score >= this.MIN_ENGAGEMENT,
      details: details.join('; '),
    };
  }

  private scoreTitleClickability(title: string): number {
    let score = 0;
    const lower = title.toLowerCase();

    if (title.includes('?')) score += 6;
    if (/\d+/.test(title)) score += 6;
    if (title.includes('|') || title.includes(':')) score += 4;

    const powerWordCount = POWER_WORDS.filter(w => lower.includes(w)).length;
    score += Math.min(8, powerWordCount * 3);

    if (lower.includes('you') || lower.includes('your')) score += 3;
    if (title.length >= 20 && title.length <= 60) score += 3;

    return Math.min(30, score);
  }

  private isEngagingHook(line: string): boolean {
    const lower = line.toLowerCase();
    return (
      lower.includes('?') ||
      /\b(you|your|imagine|ever|secret|shocking|incredible|worst|best|why|how|what if|did you|never|always|stop|don't|the truth|revealed|everyone|nobody)\b/i.test(lower)
    );
  }

  private generateHook(topic: string): string {
    const templates = [
      `You won't believe what happened when I tried ${topic} for the first time.`,
      `The shocking truth about ${topic} that nobody is talking about.`,
      `Why everyone is wrong about ${topic} (and what to do instead).`,
      `${topic} changed my life forever — here's how.`,
      `I discovered the hidden secret of ${topic} — and it's incredible.`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  private generateExpandedContent(topic: string): string {
    return `Let me explain why ${topic} matters more than you think.\n\nThe impact of ${topic} on your daily life is far greater than most people realize.\n\nHere's what the experts aren't telling you about ${topic}.\n\n`;
  }

  private generateSceneContent(topic: string): string {
    return `Now let's dive deeper into ${topic} and explore what really matters.\n\nThere's so much more to uncover about ${topic} that we haven't covered yet.\n\n`;
  }

  private removeCopyrightedTerms(text: string): string {
    let result = text;
    for (const term of COPYRIGHT_BLACKLIST) {
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      result = result.replace(regex, 'content');
    }
    return result;
  }

  private generateClickableTitle(topic: string): string {
    const templates = [
      `The ${topic} Secret Nobody Talks About`,
      `I Tried ${topic} for 30 Days — Here's What Happened`,
      `${topic}: The Ultimate Guide for Beginners`,
      `Why ${topic} Is Taking Over in 2026`,
      `Top 10 ${topic} Tips You Need to Know`,
      `How to Master ${topic} in 2026 (Complete Guide)`,
      `Stop Doing ${topic} Wrong — Do This Instead`,
      `The ${topic} Hack That Changed Everything`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }
}

export const qualityGate = new QualityGateService();
