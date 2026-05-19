import axios from 'axios';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { createTransport } from 'nodemailer';

export type NotificationEvent =
  | 'pipeline.completed'
  | 'pipeline.failed'
  | 'pipeline.step_failed'
  | 'upload.completed'
  | 'upload.failed'
  | 'daily.scheduler_run'
  | 'daily.no_channels'
  | 'system.error'
  | 'self_heal.triggered';

export interface NotificationPayload {
  event: NotificationEvent;
  title: string;
  message: string;
  projectId?: string;
  channelId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

const EVENT_EMOJI: Record<NotificationEvent, string> = {
  'pipeline.completed': '✅',
  'pipeline.failed': '❌',
  'pipeline.step_failed': '⚠️',
  'upload.completed': '📤',
  'upload.failed': '🚫',
  'daily.scheduler_run': '📅',
  'daily.no_channels': '🔌',
  'system.error': '🔥',
  'self_heal.triggered': '🩹',
};

export class NotificationService {
  async send(payload: NotificationPayload): Promise<void> {
    await Promise.allSettled([
      this.sendWebhook(payload),
      this.sendDiscord(payload),
      this.sendEmail(payload),
    ]);
  }

  async sendPipelineCompleted(projectId: string, topic: string): Promise<void> {
    await this.send({
      event: 'pipeline.completed',
      title: `Video Published: ${topic}`,
      message: `Pipeline completed successfully for "${topic}"`,
      projectId,
      metadata: { topic },
    });
  }

  async sendPipelineFailed(projectId: string, topic: string, error: string): Promise<void> {
    await this.send({
      event: 'pipeline.failed',
      title: `Pipeline Failed: ${topic}`,
      message: `Pipeline failed for "${topic}": ${error}`,
      projectId,
      metadata: { topic, error },
    });
  }

  async sendUploadCompleted(projectId: string, videoId: string, topic: string): Promise<void> {
    await this.send({
      event: 'upload.completed',
      title: `Uploaded: ${topic}`,
      message: `Video uploaded successfully (ID: ${videoId})`,
      projectId,
      metadata: { videoId, topic },
    });
  }

  async sendSelfHealTriggered(projectId: string, stepName: string, action: string): Promise<void> {
    await this.send({
      event: 'self_heal.triggered',
      title: `Self-Heal: ${stepName}`,
      message: `Self-healing triggered for ${stepName}: ${action}`,
      projectId,
      metadata: { stepName, action },
    });
  }

  async sendDailyReport(results: { generated: number; skipped: number; errors: number }): Promise<void> {
    await this.send({
      event: 'daily.scheduler_run',
      title: 'Daily Content Report',
      message: `Generated: ${results.generated} | Skipped: ${results.skipped} | Errors: ${results.errors}`,
      metadata: { ...results },
    });
  }

  private async sendDiscord(payload: NotificationPayload): Promise<void> {
    try {
      const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
      if (!webhookUrl) return;

      const emoji = EVENT_EMOJI[payload.event] || '🔔';

      await axios.post(webhookUrl, {
        embeds: [{
          title: `${emoji} ${payload.title}`,
          description: payload.message,
          color: payload.event.includes('failed') || payload.event.includes('error') ? 0xFF0000 : 0x00FF00,
          fields: [
            ...(payload.projectId ? [{ name: 'Project', value: payload.projectId.substring(0, 8), inline: true }] : []),
            ...(payload.channelId ? [{ name: 'Channel', value: payload.channelId, inline: true }] : []),
            ...(payload.metadata ? [{ name: 'Details', value: JSON.stringify(payload.metadata).substring(0, 1000), inline: false }] : []),
          ],
          timestamp: new Date().toISOString(),
        }],
      }, { timeout: 5000 });
    } catch (err: any) {
      logger.debug(`Discord notification failed (non-critical): ${err.message}`);
    }
  }

  private async sendWebhook(payload: NotificationPayload): Promise<void> {
    try {
      const webhookUrl = process.env.WEBHOOK_URL;
      if (!webhookUrl) return;

      await axios.post(webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      });
    } catch (err: any) {
      logger.debug(`Webhook notification failed (non-critical): ${err.message}`);
    }
  }

  private async sendEmail(payload: NotificationPayload): Promise<void> {
    try {
      const smtpHost = process.env.SMTP_HOST;
      const smtpPort = parseInt(process.env.SMTP_PORT || '587');
      const smtpUser = process.env.SMTP_USER;
      const smtpPass = process.env.SMTP_PASS;
      const notifyEmail = process.env.NOTIFY_EMAIL;

      if (!smtpHost || !smtpUser || !smtpPass || !notifyEmail) return;

      const transporter = createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });

      const emoji = EVENT_EMOJI[payload.event] || '🔔';

      await transporter.sendMail({
        from: smtpUser,
        to: notifyEmail,
        subject: `${emoji} ${payload.title}`,
        text: [
          payload.message,
          ...(payload.projectId ? [`Project: ${payload.projectId}`] : []),
          ...(payload.channelId ? [`Channel: ${payload.channelId}`] : []),
          ...(payload.metadata ? [`Details: ${JSON.stringify(payload.metadata, null, 2)}`] : []),
          `Time: ${new Date().toISOString()}`,
        ].join('\n'),
      });
    } catch (err: any) {
      logger.debug(`Email notification failed (non-critical): ${err.message}`);
    }
  }
}
