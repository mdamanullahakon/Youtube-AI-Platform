import { generateWithAI } from './ai.service';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { extractJson } from '../utils/parse-ai-response';

export interface RetentionCurvePoint {
  position: number;
  label: string;
  retention: number;
}

export interface RetentionSimulation {
  curve: RetentionCurvePoint[];
  hookDrop: number;
  midVideoDrops: { position: number; severity: 'critical' | 'moderate' | 'minor'; estimatedDrop: number }[];
  endingEngagement: number;
  overallScore: number;
  weakSections: string[];
  improvements: string[];
}

export class RetentionSimulator {
  async simulate(scriptContent: string, format: string, niche?: string): Promise<RetentionSimulation> {
    logger.info('Running retention simulation');

    const analysis = await generateWithAI(`
      Simulate YouTube viewer retention for this ${format} script.
      Predict minute-by-minute retention drops.

      Script:
      "${scriptContent.substring(0, 4000)}"
      ${niche ? `\nNiche: ${niche}` : ''}

      Return JSON:
      {
        "curve": [
          {"position": 0, "label": "start", "retention": 100},
          {"position": 10, "label": "10s hook", "retention": predicted_percent},
          {"position": 30, "label": "30s", "retention": predicted_percent},
          {"position": 60, "label": "1min", "retention": predicted_percent},
          {"position": 120, "label": "2min", "retention": predicted_percent},
          {"position": 180, "label": "3min", "retention": predicted_percent},
          {"position": 300, "label": "5min", "retention": predicted_percent},
          {"position": "end", "label": "end", "retention": predicted_percent}
        ],
        "hookDrop": 0-100 (percent that drops in first 10s),
        "midVideoDrops": [
          {"position": seconds, "severity": "critical"|"moderate"|"minor", "estimatedDrop": percent_drop}
        ],
        "endingEngagement": 0-100 (what % makes it to end),
        "overallScore": 0-100,
        "weakSections": ["sections most likely to lose viewers"],
        "improvements": ["specific changes to improve retention"]
      }

      Rules:
      - Hook retention usually drops 20-50% in first 10 seconds
      - Mid-video drops of 5-15% per weak section
      - Ending engagement rarely above 60% for longform
      - Be realistic based on script quality
      - Return ONLY valid JSON
    `, 'ollama', { temperature: 0.3 });

    try {
      const parsed = extractJson(analysis) as any;

      return {
        curve: Array.isArray(parsed.curve) ? parsed.curve : this.defaultCurve(),
        hookDrop: Math.min(100, Math.max(0, parsed.hookDrop || 30)),
        midVideoDrops: Array.isArray(parsed.midVideoDrops) ? parsed.midVideoDrops : [],
        endingEngagement: Math.min(100, Math.max(0, parsed.endingEngagement || 40)),
        overallScore: Math.min(100, Math.max(0, parsed.overallScore || 50)),
        weakSections: parsed.weakSections || [],
        improvements: parsed.improvements || [],
      };
    } catch {
      return {
        curve: this.defaultCurve(),
        hookDrop: 30,
        midVideoDrops: [],
        endingEngagement: 40,
        overallScore: 50,
        weakSections: ['Analysis failed'],
        improvements: ['Manual review recommended'],
      };
    }
  }

  async getRetentionCurve(projectId: string): Promise<RetentionCurvePoint[]> {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: { script: true, analytics: true },
    });
    if (!project?.script) return this.defaultCurve();
    const simulation = await this.simulate(project.script.content, project.format || 'Longform');
    return simulation.curve;
  }

  private defaultCurve(): RetentionCurvePoint[] {
    return [
      { position: 0, label: 'start', retention: 100 },
      { position: 10, label: '10s hook', retention: 70 },
      { position: 30, label: '30s', retention: 55 },
      { position: 60, label: '1min', retention: 45 },
      { position: 120, label: '2min', retention: 35 },
      { position: 180, label: '3min', retention: 30 },
      { position: 300, label: '5min', retention: 25 },
      { position: 999, label: 'end', retention: 20 },
    ];
  }
}
