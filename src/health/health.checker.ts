import http from 'http';
import { logger } from '@/config/logger';
import { env } from '@/config/env';

export interface HealthCheckOptions {
  containerName: string;
  port: number;
  path?: string;
  retries?: number;
  intervalMs?: number;
  timeoutMs?: number;
}

export async function runHealthCheck(opts: HealthCheckOptions): Promise<boolean> {
  const {
    containerName,
    port,
    path: urlPath = '/',
    retries = env.healthCheck.retries,
    intervalMs = env.healthCheck.intervalMs,
    timeoutMs = env.healthCheck.timeoutMs,
  } = opts;

  logger.info({ containerName, port, retries }, 'Starting health check');

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const ok = await httpProbe(containerName, port, urlPath, timeoutMs);
      if (ok) {
        logger.info({ containerName, attempt }, 'Health check passed');
        return true;
      }
    } catch (err) {
      logger.debug({ err, attempt, retries }, 'Health check attempt failed');
    }

    if (attempt < retries) {
      await sleep(intervalMs);
    }
  }

  logger.warn({ containerName, retries }, 'Health check failed after all attempts');
  return false;
}

function httpProbe(host: string, port: number, urlPath: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host, port, path: urlPath, method: 'GET', timeout: timeoutMs },
      (res) => {
        resolve((res.statusCode ?? 500) < 500);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Health check HTTP timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
