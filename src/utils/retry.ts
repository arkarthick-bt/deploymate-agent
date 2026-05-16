import { logger } from '@/config/logger';

export interface RetryOptions {
  attempts: number;
  delayMs: number;
  backoff?: number;
  label?: string;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastErr: unknown;
  let delay = opts.delayMs;

  for (let i = 1; i <= opts.attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      logger.debug({ attempt: i, maxAttempts: opts.attempts, label: opts.label }, 'Retry attempt failed');
      if (i < opts.attempts) {
        await sleep(delay);
        if (opts.backoff) delay = Math.floor(delay * opts.backoff);
      }
    }
  }

  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
