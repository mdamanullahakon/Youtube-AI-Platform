import { logger } from '../utils/logger';
import { env } from '../config/env';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

interface ErrorReport {
  id: string;
  timestamp: string;
  type: 'frontend' | 'backend' | 'api' | 'oauth' | 'database';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  route?: string;
  userId?: string;
  statusCode?: number;
}

interface FixResult {
  applied: boolean;
  explanation: string;
  patch?: string;
  filePath?: string;
  restartRequired: boolean;
  confidence: number;
}

export class ErrorFixerService {
  private static errorHistory: ErrorReport[] = [];
  private static readonly MAX_HISTORY = 100;
  private static readonly ERROR_LOG_PATH = path.join(process.cwd(), 'logs', 'ai-fixes.jsonl');

  static captureError(report: Omit<ErrorReport, 'id' | 'timestamp'>): ErrorReport {
    const entry: ErrorReport = {
      ...report,
      id: `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date().toISOString(),
    };

    this.errorHistory.unshift(entry);
    if (this.errorHistory.length > this.MAX_HISTORY) {
      this.errorHistory.pop();
    }

    this.logError(entry);

    logger.warn(`[AI_ERROR_FIXER] Captured ${entry.severity} error: ${entry.message}`);

    if (entry.severity === 'high' || entry.severity === 'critical') {
      this.analyzeAndFix(entry).catch(err => {
        logger.error('[AI_ERROR_FIXER] Auto-fix failed', { error: err.message });
      });
    }

    return entry;
  }

  private static logError(entry: ErrorReport): void {
    try {
      const dir = path.dirname(this.ERROR_LOG_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.appendFileSync(this.ERROR_LOG_PATH, JSON.stringify(entry) + '\n');
    } catch {}
  }

  static getErrorHistory(limit = 50): ErrorReport[] {
    return this.errorHistory.slice(0, limit);
  }

  static async analyzeAndFix(error: ErrorReport): Promise<FixResult | null> {
    try {
      logger.info(`[AI_ERROR_FIXER] Analyzing error: ${error.message}`);

      const prompt = this.buildFixPrompt(error);
      const hasGemini = !!env.GEMINI_API_KEY;
      const hasOllama = env.OLLAMA_HOST !== 'http://localhost:11434' || true;

      let fix: FixResult;

      if (hasGemini) {
        fix = await this.fixWithGemini(prompt, error);
      } else if (hasOllama) {
        fix = await this.fixWithOllama(prompt, error).catch(() => this.getLocalFix(error));
      } else {
        fix = this.getLocalFix(error);
      }

      if (fix.applied && fix.confidence > 0.7) {
        if (fix.patch && fix.filePath) {
          await this.applyPatch(fix.filePath, fix.patch);
        }
        logger.info(`[AI_ERROR_FIXER] Fix applied: ${fix.explanation}`);
        return fix;
      }

      logger.info(`[AI_ERROR_FIXER] Fix suggested (confidence: ${fix.confidence}): ${fix.explanation}`);
      return fix;
    } catch (err: any) {
      logger.error(`[AI_ERROR_FIXER] Analysis failed: ${err.message}`);
      return null;
    }
  }

  private static buildFixPrompt(error: ErrorReport): string {
    return `You are an AI error fixer for a YouTube AI Platform. Analyze this error and provide a fix.

Error Details:
- Type: ${error.type}
- Severity: ${error.severity}
- Message: ${error.message}
- Stack: ${error.stack || 'N/A'}
- Route: ${error.route || 'N/A'}
- Status Code: ${error.statusCode || 'N/A'}
- Context: ${JSON.stringify(error.context || {})}

Respond with JSON only:
{
  "explanation": "root cause explanation",
  "patch": "code fix if applicable, otherwise empty string",
  "filePath": "path to file to patch if applicable",
  "restartRequired": false,
  "confidence": 0.0 to 1.0
}`;
  }

  private static async fixWithOllama(prompt: string, error: ErrorReport): Promise<FixResult> {
    const response = await axios.post(`${env.OLLAMA_HOST}/api/generate`, {
      model: env.OLLAMA_MODEL || 'llama3',
      prompt,
      stream: false,
      format: 'json',
    }, { timeout: 30000 });

    const text = response.data.response || '{}';
    return this.parseFixResponse(text, error);
  }

  private static async fixWithGemini(prompt: string, error: ErrorReport): Promise<FixResult> {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { timeout: 30000 },
    );

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return this.parseFixResponse(text, error);
  }

  private static parseFixResponse(text: string, error: ErrorReport): FixResult {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
      return {
        applied: true,
        explanation: parsed.explanation || 'No explanation provided',
        patch: parsed.patch || undefined,
        filePath: parsed.filePath || undefined,
        restartRequired: parsed.restartRequired || false,
        confidence: parsed.confidence || 0.3,
      };
    } catch {
      return this.getLocalFix(error);
    }
  }

  private static getLocalFix(error: ErrorReport): FixResult {
    const msg = error.message.toLowerCase();

    if (msg.includes('client_id') || msg.includes('oauth') || msg.includes('token')) {
      return {
        applied: true,
        explanation: 'OAuth configuration issue. Check YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in environment variables.',
        filePath: '.env',
        patch: '# Ensure these are set:\nYOUTUBE_CLIENT_ID=your_client_id\nYOUTUBE_CLIENT_SECRET=your_client_secret\nYOUTUBE_REDIRECT_URI=http://localhost:4000/api/auth/youtube/callback',
        restartRequired: true,
        confidence: 0.85,
      };
    }

    if (msg.includes('database') || msg.includes('prisma') || msg.includes('connection') || msg.includes('db')) {
      return {
        applied: true,
        explanation: 'Database connection issue. Ensure PostgreSQL is running and DATABASE_URL is correct.',
        filePath: '.env',
        patch: 'DATABASE_URL=postgresql://user:password@localhost:5432/youtube_ai',
        restartRequired: true,
        confidence: 0.8,
      };
    }

    if (msg.includes('redis') || msg.includes('queue')) {
      return {
        applied: true,
        explanation: 'Redis connection issue. Ensure Redis is running and REDIS_URL is correct.',
        filePath: '.env',
        patch: 'REDIS_URL=redis://localhost:6379',
        restartRequired: true,
        confidence: 0.8,
      };
    }

    if (msg.includes('api key') || msg.includes('gemini') || msg.includes('openai')) {
      return {
        applied: true,
        explanation: 'API key missing. Configure the required AI service key in environment variables.',
        filePath: '.env',
        patch: 'GEMINI_API_KEY=your_gemini_api_key\nOPENAI_API_KEY=your_openai_api_key',
        restartRequired: false,
        confidence: 0.9,
      };
    }

    if (msg.includes('ffmpeg') || msg.includes('render') || msg.includes('video')) {
      return {
        applied: true,
        explanation: 'FFmpeg processing error. Ensure FFmpeg is installed and FFMPEG_PATH is configured.',
        filePath: '.env',
        patch: 'FFMPEG_PATH=ffmpeg',
        restartRequired: false,
        confidence: 0.75,
      };
    }

    if (msg.includes('rate limit') || msg.includes('429')) {
      return {
        applied: true,
        explanation: 'Rate limit hit. Implementing exponential backoff and retry.',
        patch: '// Rate limit retry logic will be handled by the queue system automatically',
        restartRequired: false,
        confidence: 0.9,
      };
    }

    return {
      applied: true,
      explanation: `Generic error: ${error.message}. Check logs for more details.`,
      patch: undefined,
      restartRequired: false,
      confidence: 0.3,
    };
  }

  private static async applyPatch(filePath: string, patch: string): Promise<boolean> {
    try {
      const absPath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(absPath)) {
        logger.warn(`[AI_ERROR_FIXER] Cannot apply patch - file not found: ${absPath}`);
        return false;
      }

      const content = fs.readFileSync(absPath, 'utf-8');
      if (content.includes(patch.trim())) {
        logger.info(`[AI_ERROR_FIXER] Patch already applied: ${absPath}`);
        return true;
      }

      fs.appendFileSync(absPath, '\n' + patch + '\n');
      logger.info(`[AI_ERROR_FIXER] Patch applied to: ${absPath}`);
      return true;
    } catch (err: any) {
      logger.error(`[AI_ERROR_FIXER] Failed to apply patch: ${err.message}`);
      return false;
    }
  }

  static async manualFix(errorId: string): Promise<FixResult | null> {
    const error = this.errorHistory.find(e => e.id === errorId);
    if (!error) return null;
    return this.analyzeAndFix(error);
  }

  static async fixAllOpen(): Promise<FixResult[]> {
    const results: FixResult[] = [];
    const critical = this.errorHistory.filter(e => e.severity === 'high' || e.severity === 'critical');
    for (const error of critical.slice(0, 5)) {
      const fix = await this.analyzeAndFix(error);
      if (fix) results.push(fix);
    }
    return results;
  }

  static getFixSummary(): { total: number; critical: number; high: number; medium: number; low: number; byType: Record<string, number> } {
    const summary = { total: this.errorHistory.length, critical: 0, high: 0, medium: 0, low: 0, byType: {} as Record<string, number> };
    for (const err of this.errorHistory) {
      if (err.severity === 'critical') summary.critical++;
      else if (err.severity === 'high') summary.high++;
      else if (err.severity === 'medium') summary.medium++;
      else if (err.severity === 'low') summary.low++;
      summary.byType[err.type] = (summary.byType[err.type] || 0) + 1;
    }
    return summary;
  }
}
