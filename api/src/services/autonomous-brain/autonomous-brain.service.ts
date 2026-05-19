import { logger } from '../../utils/logger';
import { DecisionEngine, GlobalDecision } from './decision-engine.service';
import { RiskManager, RiskReport } from './risk-manager.service';
import { GrowthAI, NicheOpportunity, ChannelCloneBlueprint } from './growth-ai.service';
import { SelfHealingAI, SystemHealthSnapshot } from './self-healing-ai.service';
import { MoneyAutomationLoop, DailyExecutionResult } from './money-automation-loop.service';
import { SmartMoneyOptimization, RevenueOptimizationReport } from './smart-money-optimization.service';
import { AutoScaling, ScalingReport } from './auto-scaling.service';
import { IntelligentExperimentEngine, ExperimentDefinition } from './intelligent-experiment-engine.service';
import { AlertReportSystem, DailyReport } from './alert-report-system.service';

export interface AutonomousBrainState {
  isRunning: boolean;
  lastCycleAt: Date | null;
  cycleCount: number;
  totalRevenue: number;
  totalProfit: number;
  videosGenerated: number;
  channelsManaged: number;
  channelsKilled: number;
  channelsScaled: number;
  errors: number;
  healCount: number;
  overallHealth: 'excellent' | 'good' | 'fair' | 'critical';
}

export class AutonomousBrain {
  private decisionEngine: DecisionEngine;
  private riskManager: RiskManager;
  private growthAI: GrowthAI;
  private selfHealingAI: SelfHealingAI;
  private moneyLoop: MoneyAutomationLoop;
  private moneyOptimization: SmartMoneyOptimization;
  private autoScaling: AutoScaling;
  private experimentEngine: IntelligentExperimentEngine;
  private alertSystem: AlertReportSystem;

  private state: AutonomousBrainState = {
    isRunning: false,
    lastCycleAt: null,
    cycleCount: 0,
    totalRevenue: 0,
    totalProfit: 0,
    videosGenerated: 0,
    channelsManaged: 0,
    channelsKilled: 0,
    channelsScaled: 0,
    errors: 0,
    healCount: 0,
    overallHealth: 'good',
  };

  constructor() {
    this.decisionEngine = new DecisionEngine();
    this.riskManager = new RiskManager();
    this.growthAI = new GrowthAI();
    this.selfHealingAI = new SelfHealingAI();
    this.moneyLoop = new MoneyAutomationLoop();
    this.moneyOptimization = new SmartMoneyOptimization();
    this.autoScaling = new AutoScaling();
    this.experimentEngine = new IntelligentExperimentEngine();
    this.alertSystem = new AlertReportSystem();
  }

  async executeFullCycle(dryRun = false): Promise<{
    decisions: GlobalDecision;
    execution: DailyExecutionResult;
    scaling: ScalingReport;
    optimization: RevenueOptimizationReport[];
    experiments: ExperimentDefinition[];
    report: DailyReport;
  }> {
    logger.info('========================================');
    logger.info('[AutonomousBrain] Starting full execution cycle');
    logger.info('========================================');

    this.state.isRunning = true;
    const startTime = Date.now();

    try {
      const healthCheck = await this.selfHealingAI.checkSystemHealth();
      if (healthCheck.status === 'unhealthy') {
        await this.alertSystem.sendAlert('System unhealthy — running self-healing first', 'warning');
        const stuckQueues = await this.selfHealingAI.detectAndFixStuckQueues();
        const stuckPipelines = await this.selfHealingAI.detectAndFixCrashedPipelines();
        const stuckRenders = await this.selfHealingAI.detectAndFixStuckRenders();
        if (stuckQueues.length > 0 || stuckPipelines.length > 0 || stuckRenders.length > 0) {
          logger.info(`[AutonomousBrain] Self-healed: ${stuckQueues.length} queues, ${stuckPipelines.length} pipelines, ${stuckRenders.length} renders`);
        }
      }

      const riskReport = await this.riskManager.getOverallRiskReport();
      const pausedChannels = await this.riskManager.autoPauseRiskyChannels();
      if (pausedChannels.paused.length > 0) {
        logger.warn(`[AutonomousBrain] Auto-paused ${pausedChannels.paused.length} high-risk channels`);
      }

      const decisions = await this.decisionEngine.evaluateAllChannels();
      if (decisions.channelsToKill.length > 0 && !dryRun) {
        await this.decisionEngine.executeDecisions(decisions, false);
        this.state.channelsKilled += decisions.channelsToKill.length;
      }
      this.state.channelsManaged = decisions.channelDecisions.length;

      const execution = await this.moneyLoop.runDailyMoneyLoop(dryRun);

      this.state.videosGenerated += execution.videosUploaded;
      this.state.totalRevenue += execution.totalRevenue;
      this.state.totalProfit += execution.netProfit;

      const scaling = await this.autoScaling.evaluateAndScale();
      this.state.channelsScaled = scaling.totalChannelsScaled;

      const channels = decisions.channelDecisions.map(d => d.channelId);
      const optimizationReports: RevenueOptimizationReport[] = [];
      for (const chId of channels.slice(0, 5)) {
        try {
          const report = await this.moneyOptimization.optimizeChannelRevenue(chId);
          optimizationReports.push(report);
        } catch {}
      }

      const experiments: ExperimentDefinition[] = [];
      for (const ch of decisions.channelDecisions.slice(0, 3)) {
        const niche = ch.recommendedNiche || 'general';
        const channelExperiments = await this.experimentEngine.designExperiments(ch.channelId, niche);
        experiments.push(...channelExperiments);
      }

      const winningPatterns = await this.experimentEngine.getWinningPatterns(3);
      for (const ch of decisions.channelDecisions.slice(0, 2)) {
        await this.experimentEngine.applyWinningPatterns(ch.channelId);
      }

      if (scaling.totalChannelsKilled > 0 || riskReport.criticalChannels > 0) {
        await this.alertSystem.sendAlert(
          `${scaling.totalChannelsKilled} channels killed, ${riskReport.criticalChannels} at critical risk`,
          'critical'
        );
      }

      const report = await this.alertSystem.generateDailyReport();

      this.state.cycleCount++;
      this.state.lastCycleAt = new Date();
      this.state.isRunning = false;
      this.state.overallHealth = decisions.overallHealth;

      const elapsed = Date.now() - startTime;
      logger.info('========================================');
      logger.info(`[AutonomousBrain] Cycle complete in ${elapsed}ms`);
      logger.info(`  Videos: ${execution.videosUploaded} | Revenue: $${execution.totalRevenue} | Profit: $${execution.netProfit}`);
      logger.info(`  Scaled: ${scaling.totalChannelsScaled} | Killed: ${scaling.totalChannelsKilled} | Score: ${report.overallScore}/100`);
      logger.info('========================================');

      return { decisions, execution, scaling, optimization: optimizationReports, experiments, report };
    } catch (err: any) {
      this.state.errors++;
      this.state.isRunning = false;
      logger.error(`[AutonomousBrain] Cycle failed: ${err.message}`);

      await this.selfHealingAI.heal('crash', err.message, 'autonomous-brain');
      await this.alertSystem.sendAlert(`Autonomous brain cycle failed: ${err.message}`, 'critical');

      throw err;
    }
  }

  getState(): AutonomousBrainState {
    return { ...this.state };
  }

  isHealthy(): boolean {
    return this.state.overallHealth !== 'critical' && !this.state.isRunning;
  }

  async simulate7Days(channels: { channelId: string; channelTitle: string }[]): Promise<{
    simulation: any;
    experiments: ExperimentDefinition[];
    winningPatterns: any[];
    state: AutonomousBrainState;
  }> {
    logger.info('========================================');
    logger.info('[AutonomousBrain] Starting 7-day simulation');
    logger.info(`  Channels: ${channels.map(c => c.channelTitle).join(', ')}`);
    logger.info('========================================');

    const simulation = await this.moneyLoop.simulateDailyExecution(channels, 7);

    const experiments: ExperimentDefinition[] = [];
    for (const ch of channels) {
      const channelExperiments = await this.experimentEngine.designExperiments(ch.channelId, 'simulation');
      experiments.push(...channelExperiments);
    }

    const winningPatterns = await this.experimentEngine.getWinningPatterns(10);

    this.state.totalRevenue += simulation.totalRevenue;
    this.state.totalProfit += simulation.totalProfit;
    this.state.videosGenerated += simulation.totalVideos;
    this.state.channelsScaled = simulation.channelsScaled.length;
    this.state.channelsKilled = simulation.channelsKilled.length;
    this.state.cycleCount += 7;

    logger.info('========================================');
    logger.info('[AutonomousBrain] 7-day simulation complete');
    logger.info(`  Total Videos: ${simulation.totalVideos}`);
    logger.info(`  Total Revenue: $${simulation.totalRevenue}`);
    logger.info(`  Total Profit: $${simulation.totalProfit}`);
    logger.info(`  Scaled: ${simulation.channelsScaled.length} | Killed: ${simulation.channelsKilled.length}`);
    logger.info('========================================');

    return { simulation, experiments, winningPatterns, state: this.getState() };
  }

  async sendAlert(message: string, level: 'info' | 'warning' | 'critical'): Promise<void> {
    await this.alertSystem.sendAlert(message, level);
  }
}
