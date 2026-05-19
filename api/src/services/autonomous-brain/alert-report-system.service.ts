import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import fs from 'fs';
import path from 'path';
import { generateWithAI } from '../ai.service';
import { DecisionEngine, GlobalDecision } from './decision-engine.service';
import { RiskManager, RiskReport } from './risk-manager.service';
import { SelfHealingAI, SystemHealthSnapshot } from './self-healing-ai.service';
import { AutoScaling, ScalingReport } from './auto-scaling.service';
import { SmartMoneyOptimization, RevenueOptimizationReport } from './smart-money-optimization.service';

export interface DailyReport {
  date: string;
  summary: {
    totalChannels: number;
    activeChannels: number;
    totalVideosUploaded: number;
    totalRevenue: number;
    totalProfit: number;
    averageCTR: number;
    averageRetention: number;
  };
  bestPerformingVideo: { title: string; revenue: number; views: number; ctr: number } | null;
  worstPerformingVideo: { title: string; revenue: number; views: number; ctr: number } | null;
  scalingSummary: {
    channelsScaled: string[];
    channelsKilled: string[];
    channelsPaused: string[];
    totalUploadCapacity: number;
  };
  riskSummary: {
    riskLevel: string;
    channelsAtRisk: string[];
    apiQuotaUsed: number;
    channelsOnCooldown: number;
  };
  moneyOptimization: {
    channelsOptimized: number;
    averageProfitScore: number;
    potentialRevenueGain: number;
    topRecommendations: string[];
  };
  systemHealth: {
    status: string;
    activeFailures: number;
    healedCount: number;
    uptimeHours: number;
  };
  experimentResults: {
    activeExperiments: number;
    completedExperiments: number;
    winnersFound: number;
  };
  overallScore: number;
  recommendations: string[];
}

export class AlertReportSystem {
  private decisionEngine: DecisionEngine;
  private riskManager: RiskManager;
  private selfHealingAI: SelfHealingAI;
  private autoScaling: AutoScaling;
  private moneyOptimization: SmartMoneyOptimization;
  private reportDir: string;

  constructor() {
    this.decisionEngine = new DecisionEngine();
    this.riskManager = new RiskManager();
    this.selfHealingAI = new SelfHealingAI();
    this.autoScaling = new AutoScaling();
    this.moneyOptimization = new SmartMoneyOptimization();
    this.reportDir = path.join(process.cwd(), 'logs', 'reports');
    if (!fs.existsSync(this.reportDir)) {
      fs.mkdirSync(this.reportDir, { recursive: true });
    }
  }

  async generateDailyReport(): Promise<DailyReport> {
    const startTime = Date.now();

    const channels = await prisma.youTubeAccount.findMany({ where: { isConnected: true } });
    const projects = await prisma.videoProject.findMany({
      where: { uploadHistory: { status: 'published' } },
      include: { analytics: true, uploadHistory: true, monetizationConversion: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const globalDecision = await this.decisionEngine.evaluateAllChannels();
    const riskReport = await this.riskManager.getOverallRiskReport();
    const systemHealth = await this.selfHealingAI.checkSystemHealth() as unknown as SystemHealthSnapshot;

    const scalingReport = await this.autoScaling.evaluateAndScale();
    const optimizationReport = await this.moneyOptimization.getGlobalOptimizationReport();

    const withAnalytics = projects.filter(p => p.analytics);
    const avgCTR = withAnalytics.length > 0
      ? withAnalytics.reduce((s, p) => s + (p.analytics?.ctr || 0), 0) / withAnalytics.length
      : 0;
    const avgRetention = withAnalytics.length > 0
      ? withAnalytics.reduce((s, p) => s + (p.analytics?.retention || 0), 0) / withAnalytics.length
      : 0;

    let totalRevenue = 0;
    for (const p of projects) {
      const views = p.analytics?.views || 0;
      totalRevenue += (views / 1000) * 4;
      const convs = p.monetizationConversion || [];
      if (Array.isArray(convs)) {
        totalRevenue += convs.reduce((s: number, c: any) => s + (c.revenue || 0), 0);
      }
    }

    const totalCost = projects.length * 10;
    const totalProfit = totalRevenue - totalCost;

    const sortedByRevenue = [...projects].sort((a, b) => {
      const revA = (a.analytics?.views || 0) / 1000 * 4;
      const revB = (b.analytics?.views || 0) / 1000 * 4;
      return revB - revA;
    });

    const bestVideo = sortedByRevenue[0] ? {
      title: sortedByRevenue[0].title || 'Untitled',
      revenue: (sortedByRevenue[0].analytics?.views || 0) / 1000 * 4,
      views: sortedByRevenue[0].analytics?.views || 0,
      ctr: sortedByRevenue[0].analytics?.ctr || 0,
    } : null;

    const worstVideo = sortedByRevenue.length > 0 ? {
      title: sortedByRevenue[sortedByRevenue.length - 1].title || 'Untitled',
      revenue: (sortedByRevenue[sortedByRevenue.length - 1].analytics?.views || 0) / 1000 * 4,
      views: sortedByRevenue[sortedByRevenue.length - 1].analytics?.views || 0,
      ctr: sortedByRevenue[sortedByRevenue.length - 1].analytics?.ctr || 0,
    } : null;

    const completedExperiments = await prisma.aBTestResult.count({ where: { status: 'completed' } });
    const activeExperiments = await prisma.aBTestResult.count({ where: { status: 'running' } });
    const significantExperiments = await prisma.aBTestResult.count({
      where: { statisticallySignificant: true },
    });

    const overallScore = this.calculateOverallScore(
      channels.length, avgCTR, avgRetention, totalProfit,
      riskReport, globalDecision
    );

    const recommendations = await this.generateRecommendations(
      globalDecision, riskReport, scalingReport, systemHealth
    );

    const report: DailyReport = {
      date: new Date().toISOString(),
      summary: {
        totalChannels: channels.length,
        activeChannels: channels.filter(c => c.isConnected).length,
        totalVideosUploaded: projects.length,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalProfit: Math.round(totalProfit * 100) / 100,
        averageCTR: Math.round(avgCTR * 100) / 100,
        averageRetention: Math.round(avgRetention * 100) / 100,
      },
      bestPerformingVideo: bestVideo,
      worstPerformingVideo: worstVideo,
      scalingSummary: {
        channelsScaled: scalingReport.decisions.filter(d => d.action === 'scale-up').map(d => d.channelTitle),
        channelsKilled: scalingReport.decisions.filter(d => d.action === 'kill').map(d => d.channelTitle),
        channelsPaused: scalingReport.decisions.filter(d => d.action === 'scale-down' || d.action === 'pivot-niche').map(d => d.channelTitle),
        totalUploadCapacity: scalingReport.totalUploadCapacity,
      },
      riskSummary: {
        riskLevel: riskReport.criticalChannels > 0 ? 'critical' : riskReport.elevatedChannels > 0 ? 'elevated' : 'normal',
        channelsAtRisk: [...riskReport.channelsWithViolations, ...riskReport.channelsWithLowPerformance],
        apiQuotaUsed: riskReport.apiQuotaUsed,
        channelsOnCooldown: riskReport.channelsOnCooldown,
      },
      moneyOptimization: {
        channelsOptimized: optimizationReport.channelsOptimized,
        averageProfitScore: optimizationReport.averageProfitScore,
        potentialRevenueGain: optimizationReport.totalPotentialRevenueGain,
        topRecommendations: optimizationReport.topRecommendations.slice(0, 3),
      },
      systemHealth: {
        status: systemHealth.status,
        activeFailures: systemHealth.activeFailures,
        healedCount: systemHealth.recentHeals,
        uptimeHours: systemHealth.uptimeHours,
      },
      experimentResults: {
        activeExperiments,
        completedExperiments,
        winnersFound: significantExperiments,
      },
      overallScore,
      recommendations,
    };

    await this.saveReportToFile(report);
    this.logReportToConsole(report);

    return report;
  }

  private calculateOverallScore(
    channelCount: number,
    avgCTR: number,
    avgRetention: number,
    totalProfit: number,
    riskReport: RiskReport,
    globalDecision: GlobalDecision
  ): number {
    let score = 0;

    score += Math.min(20, channelCount * 4);
    score += Math.min(20, avgCTR * 4);
    score += Math.min(20, avgRetention * 0.4);
    score += Math.min(20, Math.max(0, totalProfit / 10));

    const healthRatio = riskReport.totalChannels > 0
      ? (riskReport.safeChannels / riskReport.totalChannels) * 20
      : 10;
    score += healthRatio;

    if (globalDecision.overallHealth === 'excellent') score += 5;
    if (globalDecision.overallHealth === 'critical') score -= 10;

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  private async generateRecommendations(
    globalDecision: GlobalDecision,
    riskReport: RiskReport,
    scalingReport: ScalingReport,
    systemHealth: SystemHealthSnapshot
  ): Promise<string[]> {
    const recommendations: string[] = [];

    if (scalingReport.totalChannelsKilled > 0) {
      recommendations.push(`${scalingReport.totalChannelsKilled} channel(s) killed. Review why they failed and avoid repeating patterns.`);
    }

    if (riskReport.criticalChannels > 0) {
      recommendations.push(`${riskReport.criticalChannels} channel(s) at critical risk. Immediate attention required.`);
    }

    if (riskReport.apiQuotaUsed > 8000) {
      recommendations.push('API quota near limit. Consider reducing non-essential API calls.');
    }

    if (globalDecision.overallHealth === 'critical') {
      recommendations.push('Overall system health is critical. Pause non-essential operations and audit all channels.');
    }

    if (globalDecision.channelsToScale.length > 0) {
      recommendations.push(`${globalDecision.channelsToScale.length} channel(s) ready to scale. Increase resource allocation.`);
    }

    if (recommendations.length === 0) {
      recommendations.push('All systems nominal. Continue current strategy.');
    }

    return recommendations;
  }

  private async saveReportToFile(report: DailyReport): Promise<void> {
    const dateStr = new Date().toISOString().split('T')[0];
    const filePath = path.join(this.reportDir, `daily-report-${dateStr}.json`);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
    logger.info(`[AlertReport] Daily report saved to ${filePath}`);
  }

  private logReportToConsole(report: DailyReport): void {
    const border = '═'.repeat(60);

    console.log(`\n${border}`);
    console.log(`  📊 AUTONOMOUS BRAIN — DAILY REPORT`);
    console.log(`  ${report.date}`);
    console.log(border);
    console.log(`  📈 OVERVIEW`);
    console.log(`  ───────────────────────────────────────────`);
    console.log(`  Channels: ${report.summary.totalChannels} total, ${report.summary.activeChannels} active`);
    console.log(`  Videos Uploaded: ${report.summary.totalVideosUploaded}`);
    console.log(`  Revenue: $${report.summary.totalRevenue.toFixed(2)}`);
    console.log(`  Profit: $${report.summary.totalProfit.toFixed(2)}`);
    console.log(`  Avg CTR: ${report.summary.averageCTR}%`);
    console.log(`  Avg Retention: ${report.summary.averageRetention}%`);
    console.log(`\n  🏆 BEST VIDEO: ${report.bestPerformingVideo?.title || 'N/A'}`);
    if (report.bestPerformingVideo) {
      console.log(`     Views: ${report.bestPerformingVideo.views} | CTR: ${report.bestPerformingVideo.ctr}% | Revenue: $${report.bestPerformingVideo.revenue.toFixed(2)}`);
    }
    console.log(`\n  ❌ WORST VIDEO: ${report.worstPerformingVideo?.title || 'N/A'}`);
    if (report.worstPerformingVideo) {
      console.log(`     Views: ${report.worstPerformingVideo.views} | CTR: ${report.worstPerformingVideo.ctr}% | Revenue: $${report.worstPerformingVideo.revenue.toFixed(2)}`);
    }
    console.log(`\n  🚀 SCALING`);
    console.log(`  ───────────────────────────────────────────`);
    console.log(`  Scaled: ${report.scalingSummary.channelsScaled.join(', ') || 'None'}`);
    console.log(`  Killed: ${report.scalingSummary.channelsKilled.join(', ') || 'None'}`);
    console.log(`  Paused: ${report.scalingSummary.channelsPaused.join(', ') || 'None'}`);
    console.log(`\n  ⚠️  RISK`);
    console.log(`  ───────────────────────────────────────────`);
    console.log(`  Level: ${report.riskSummary.riskLevel}`);
    console.log(`  API Quota Used: ${report.riskSummary.apiQuotaUsed}/10000`);
    console.log(`  Cooldowns: ${report.riskSummary.channelsOnCooldown}`);
    console.log(`\n  💰 MONEY OPTIMIZATION`);
    console.log(`  ───────────────────────────────────────────`);
    console.log(`  Avg Profit Score: ${report.moneyOptimization.averageProfitScore}/100`);
    console.log(`  Potential Revenue Gain: $${report.moneyOptimization.potentialRevenueGain.toFixed(2)}`);
    console.log(`\n  🔬 EXPERIMENTS`);
    console.log(`  ───────────────────────────────────────────`);
    console.log(`  Active: ${report.experimentResults.activeExperiments} | Completed: ${report.experimentResults.completedExperiments} | Winners: ${report.experimentResults.winnersFound}`);
    console.log(`\n  🏥 SYSTEM HEALTH: ${report.systemHealth.status.toUpperCase()}`);
    console.log(`  Failures: ${report.systemHealth.activeFailures} | Heals: ${report.systemHealth.healedCount} | Uptime: ${report.systemHealth.uptimeHours}h`);
    console.log(`\n  🎯 OVERALL SCORE: ${report.overallScore}/100`);
    console.log(`\n  💡 RECOMMENDATIONS`);
    for (const rec of report.recommendations) {
      console.log(`  → ${rec}`);
    }
    console.log(border);
    console.log(`  Report saved to: logs/reports/daily-report-${new Date().toISOString().split('T')[0]}.json`);
    console.log(border);
  }

  async sendAlert(message: string, level: 'info' | 'warning' | 'critical'): Promise<void> {
    const timestamp = new Date().toISOString();
    const alertLine = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    const alertFile = path.join(this.reportDir, 'alerts.log');
    fs.appendFileSync(alertFile, alertLine + '\n');

    switch (level) {
      case 'critical':
        logger.error(`[AUTONOMOUS ALERT] ${message}`);
        break;
      case 'warning':
        logger.warn(`[AUTONOMOUS ALERT] ${message}`);
        break;
      default:
        logger.info(`[AUTONOMOUS ALERT] ${message}`);
    }
  }
}
