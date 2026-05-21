import pino from 'pino';
import path from 'path';
import fs from 'fs';

const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const isProduction = process.env.NODE_ENV === 'production';

const fileTransport = pino.transport({
  targets: [
    {
      target: 'pino/file',
      options: {
        destination: path.join(logDir, 'api.log'),
        mkdir: true,
      },
    },
    {
      target: 'pino/file',
      options: {
        destination: path.join(logDir, 'api-error.log'),
        mkdir: true,
      },
      level: 'error',
    },
  ],
});

const baseLogger = pino(
  {
    level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
    redact: {
      paths: [
        'req.headers.authorization', 'req.headers.cookie',
        'body.password', 'body.token', 'body.accessToken', 'body.refreshToken',
      ],
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  fileTransport,
);

interface LoggerInstance {
  info: (msg: string, meta?: any) => void;
  warn: (msg: string, meta?: any) => void;
  error: (msg: string, meta?: any) => void;
  debug: (msg: string, meta?: any) => void;
  child: (bindings: Record<string, unknown>) => LoggerInstance;
}

function wrapPino(pinoInstance: pino.Logger): LoggerInstance {
  const log = (level: string, msg: string, meta?: any) => {
    if (meta !== undefined && meta !== null) {
      (pinoInstance as any)[level](meta instanceof Error ? { err: meta } : meta, msg);
    } else {
      (pinoInstance as any)[level](msg);
    }
  };

  return {
    info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
    debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
    child: (bindings: Record<string, unknown>): LoggerInstance => wrapPino(pinoInstance.child(bindings)),
  };
}

export const apiLogger = wrapPino(baseLogger.child({ service: 'api' }));
export const aiLogger = wrapPino(baseLogger.child({ service: 'ai' }));
export const queueLogger = wrapPino(baseLogger.child({ service: 'queue' }));
export const pipelineLogger = wrapPino(baseLogger.child({ service: 'pipeline' }));

export const logger = apiLogger;
