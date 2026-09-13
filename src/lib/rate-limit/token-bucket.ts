/**
 * Minimal in-process token bucket limiter. Good enough for a single Next.js
 * server instance; a multi-instance deployment should move this to a shared
 * store (e.g. a Postgres/Redis-backed bucket) — noted as a Phase 2 concern.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number
  ) {
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillMs) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillPerSecond);
    this.lastRefillMs = now;
  }

  async take(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = ((1 - this.tokens) / this.refillPerSecond) * 1000;
      await new Promise((resolve) => setTimeout(resolve, Math.max(waitMs, 10)));
    }
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    retries?: number;
    baseDelayMs?: number;
    /**
     * Pure observer, called for every failed attempt (including the final
     * one that exhausts retries) — for telemetry/diagnostics only (see
     * error-classification.ts). Never influences whether/how many times to
     * retry, the backoff delay, or which errors are considered retryable —
     * retry behavior itself is deliberately unchanged in this phase (see
     * the Corrective Phase v2 plan's Objective 3: diagnose first).
     */
    onRetry?: (error: unknown, attempt: number) => void;
  } = {}
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 300;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      opts.onRetry?.(error, attempt);
      if (attempt === retries) break;
      const delay = baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
