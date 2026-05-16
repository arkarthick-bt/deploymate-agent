import { createLogger, format, transports, Logger as WinstonLogger } from 'winston';
import { env } from './env';

const { combine, timestamp, colorize, printf, errors } = format;

const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${ts} [${level}] ${stack ?? message}${metaStr}`;
  }),
);

const prodFormat = combine(timestamp(), errors({ stack: true }), format.json());

const winstonLevels = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

const winstonLogger = createLogger({
  levels: winstonLevels,
  level: env.logLevel,
  format: env.nodeEnv === 'production' ? prodFormat : devFormat,
  transports: [new transports.Console()],
});

// Pino-compatible logger interface: logger.info({ meta }, 'message') or logger.info('message')
type LogFn = (metaOrMsg: Record<string, unknown> | string, msg?: string) => void;

function makeLogFn(level: keyof typeof winstonLevels): LogFn {
  return (metaOrMsg, msg) => {
    if (typeof metaOrMsg === 'string') {
      winstonLogger.log(level, metaOrMsg);
    } else {
      winstonLogger.log(level, msg ?? '', metaOrMsg);
    }
  };
}

export const logger = {
  fatal: makeLogFn('fatal'),
  error: makeLogFn('error'),
  warn: makeLogFn('warn'),
  info: makeLogFn('info'),
  debug: makeLogFn('debug'),
  trace: makeLogFn('trace'),
};
