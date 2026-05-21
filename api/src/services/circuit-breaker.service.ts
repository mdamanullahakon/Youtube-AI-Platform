import { logger } from '../utils/logger';

type BreakerState = 'closed' | 'open' | 'half-open';

interface BreakerOptions {
  name: string;
  timeout: number;
  errorThresholdPercentage: number;
  resetTimeout: number;
  volumeThreshold: number;
}

interface BreakerStats {
  state: BreakerState;
  failures: number;
  successes: number;
  totalRequests: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  openedAt: Date | null;
}

export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures = 0;
  private successes = 0;
  private totalRequests = 0;
  private lastFailure: Date | null = null;
  private lastSuccess: Date | null = null;
  private openedAt: Date | null = null;
  private readonly options: BreakerOptions;
  private halfOpenTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: Partial<BreakerOptions> & { name: string }) {
    this.options = {
      timeout: 120000,
      errorThresholdPercentage: 50,
      resetTimeout: 300000,
      volumeThreshold: 3,
      ...options,
    };
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    if (this.state === 'open') {
      if (this.shouldAttemptReset()) {
        this.state = 'half-open';
        logger.info(`[CircuitBreaker:${this.options.name}] Half-open — allowing test request`);
      } else {
        const retryAfter = this.openedAt
          ? Math.ceil((this.options.resetTimeout - (Date.now() - this.openedAt.getTime())) / 1000)
          : this.options.resetTimeout / 1000;
        throw new CircuitBreakerOpenError(this.options.name, retryAfter);
      }
    }

    try {
      const result = await Promise.race([
        fn(),
        this.timeoutPromise<T>(),
      ]);
      this.onSuccess();
      return result;
    } catch (err: any) {
      this.onFailure();
      throw err;
    }
  }

  getState(): BreakerState {
    return this.state;
  }

  getStats(): BreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      totalRequests: this.totalRequests,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      openedAt: this.openedAt,
    };
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.successes = 0;
    this.openedAt = null;
    this.lastFailure = null;
    this.halfOpenTimer = null;
    logger.info(`[CircuitBreaker:${this.options.name}] Reset to closed`);
  }

  private onSuccess(): void {
    this.successes++;
    this.lastSuccess = new Date();

    if (this.state === 'half-open') {
      this.state = 'closed';
      this.failures = 0;
      this.openedAt = null;
      logger.info(`[CircuitBreaker:${this.options.name}] Closed after successful half-open request`);
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = new Date();

    if (this.state === 'half-open') {
      this.state = 'open';
      this.openedAt = new Date();
      logger.warn(`[CircuitBreaker:${this.options.name}] Re-opened after half-open failure`);
      return;
    }

    if (this.totalRequests >= this.options.volumeThreshold) {
      const errorRate = (this.failures / this.totalRequests) * 100;
      if (errorRate >= this.options.errorThresholdPercentage) {
        this.state = 'open';
        this.openedAt = new Date();
        logger.warn(
          `[CircuitBreaker:${this.options.name}] Opened — ${errorRate.toFixed(0)}% failure rate (threshold: ${this.options.errorThresholdPercentage}%)`,
        );
      }
    }
  }

  private shouldAttemptReset(): boolean {
    if (!this.openedAt) return true;
    return Date.now() - this.openedAt.getTime() >= this.options.resetTimeout;
  }

  private timeoutPromise<T>(): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Circuit breaker "${this.options.name}" timed out after ${this.options.timeout}ms`));
      }, this.options.timeout);
    });
  }
}

export class CircuitBreakerOpenError extends Error {
  retryAfterSeconds: number;
  constructor(name: string, retryAfterSeconds: number) {
    super(`Circuit breaker "${name}" is open. Retry after ${retryAfterSeconds}s`);
    this.name = 'CircuitBreakerOpenError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const breakers = new Map<string, CircuitBreaker>();

export function getBreaker(name: string, options?: Partial<BreakerOptions>): CircuitBreaker {
  if (!breakers.has(name)) {
    breakers.set(name, new CircuitBreaker({ name, ...options }));
  }
  return breakers.get(name)!;
}

export const youtubeBreaker = () => getBreaker('youtube-upload', {
  timeout: 120000,
  errorThresholdPercentage: 50,
  resetTimeout: 300000,
  volumeThreshold: 3,
});

export const aiBreaker = () => getBreaker('ai-service', {
  timeout: 60000,
  errorThresholdPercentage: 40,
  resetTimeout: 60000,
  volumeThreshold: 5,
});

export const renderBreaker = () => getBreaker('ffmpeg-render', {
  timeout: 600000,
  errorThresholdPercentage: 30,
  resetTimeout: 120000,
  volumeThreshold: 3,
});
