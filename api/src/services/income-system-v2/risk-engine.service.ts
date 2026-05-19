import { prisma } from '../../config/db';
import type { IncomeRiskAlert } from './types';

const MAX_RETENTION_FAILURES = 3;
const MAX_CTR_FAILURES = 3;
const CRITICAL_CTR = 0.5;
const CRITICAL_RETENTION = 10;

export async function assessCycleRisk(channelId: string, cycleId: string, cycleLogId?: string): Promise<IncomeRiskAlert[]> {
  const alerts: IncomeRiskAlert[] = [];
  const recentVideos = await prisma.incomeVideoOutput.findMany({
    where: {
      channelId,
      cycleId,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  const snapshots = await prisma.incomeAnalyticsSnapshot.findMany({
    where: {
      channelId,
      projectId: { in: recentVideos.map(v => v.projectId) },
    },
    orderBy: { collectedAt: 'desc' },
  });

  const lowCtrCount = snapshots.filter(s => s.ctr < CRITICAL_CTR).length;
  const lowRetentionCount = snapshots.filter(s => s.retention < CRITICAL_RETENTION).length;

  if (lowCtrCount >= MAX_CTR_FAILURES) {
    alerts.push({
      channelId,
      alertType: 'low-ctr',
      severity: 'medium',
      message: `CTR is critically low on ${lowCtrCount} recent videos`,
      details: { lowCtrCount, threshold: CRITICAL_CTR },
      timestamp: new Date(),
    });
  }
  if (lowRetentionCount >= MAX_RETENTION_FAILURES) {
    alerts.push({
      channelId,
      alertType: 'low-retention',
      severity: 'medium',
      message: `Retention is critically low on ${lowRetentionCount} recent videos`,
      details: { lowRetentionCount, threshold: CRITICAL_RETENTION },
      timestamp: new Date(),
    });
  }

  const failedUploads = recentVideos.filter(v => v.uploadStatus === 'failed').length;
  if (failedUploads > 0) {
    alerts.push({
      channelId,
      alertType: 'upload-failure',
      severity: 'high',
      message: `${failedUploads} videos failed to upload this cycle`,
      details: { failedUploads, cycleId },
      timestamp: new Date(),
    });
  }

  const cycleLogDbId = cycleLogId || (await prisma.incomeCycleLog.findFirst({
    where: { channelId, cycleDate: cycleId.split('_').slice(-1)[0] || '' },
    orderBy: { createdAt: 'desc' },
  }))?.id;
  if (cycleLogDbId) {
    await prisma.incomeCycleLog.update({
      where: { id: cycleLogDbId },
      data: { riskFlags: JSON.stringify(alerts.map(a => a.alertType)) },
    });
  }

  return alerts;
}

export async function storeRiskAlerts(alerts: IncomeRiskAlert[]): Promise<void> {
  if (alerts.length === 0) return;
  for (const alert of alerts) {
    if (alert.severity === 'high' || alert.severity === 'critical') {
      console.warn(`[RiskEngine] ${alert.severity.toUpperCase()}: ${alert.message}`);
    }
  }
}
