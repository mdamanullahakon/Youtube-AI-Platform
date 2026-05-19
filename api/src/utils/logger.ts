import winston from 'winston';
import path from 'path';
import fs from 'fs';

const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const isProduction = process.env.NODE_ENV === 'production';

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  isProduction
    ? winston.format.json()
    : winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    if (isProduction) {
      return JSON.stringify({ timestamp, level, message, ...meta });
    }
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}]: ${message}${metaStr}`;
  })
);

const createLogger = (name: string, level?: string) => {
  const transports: winston.transport[] = [
    new winston.transports.Console({ format: consoleFormat }),
  ];

  if (isProduction) {
    // Production: daily rotating files
    try {
      const DailyRotateFile = require('winston-daily-rotate-file');
      transports.push(
        new DailyRotateFile({
          filename: path.join(logDir, `${name}-%DATE%.log`),
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '14d',
          format: winston.format.json(),
        })
      );
      transports.push(
        new DailyRotateFile({
          filename: path.join(logDir, `${name}-error-%DATE%.log`),
          datePattern: 'YYYY-MM-DD',
          level: 'error',
          maxSize: '20m',
          maxFiles: '30d',
          format: winston.format.json(),
        })
      );
    } catch {
      transports.push(
        new winston.transports.File({
          filename: path.join(logDir, `${name}.log`),
          maxsize: 5242880,
          maxFiles: 5,
        }),
        new winston.transports.File({
          filename: path.join(logDir, `${name}-error.log`),
          level: 'error',
          maxsize: 5242880,
          maxFiles: 10,
        })
      );
    }
  } else {
    // Development: simple file rotation with size caps
    transports.push(
      new winston.transports.File({
        filename: path.join(logDir, `${name}.log`),
        maxsize: 1048576,
        maxFiles: 3,
        tailable: true,
      }),
      new winston.transports.File({
        filename: path.join(logDir, `${name}-error.log`),
        level: 'error',
        maxsize: 1048576,
        maxFiles: 3,
        tailable: true,
      })
    );
  }

  return winston.createLogger({
    level: level || (isProduction ? 'info' : 'debug'),
    format: winston.format.json(),
    defaultMeta: { service: name },
    transports,
  });
};

export const apiLogger = createLogger('api', process.env.LOG_LEVEL);
export const aiLogger = createLogger('ai', 'info');
export const queueLogger = createLogger('queue', 'info');
export const pipelineLogger = createLogger('pipeline', 'info');

export const logger = apiLogger;
