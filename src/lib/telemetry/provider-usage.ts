/**
 * Pure helpers for Provider Usage Telemetry — no I/O, so unit-testable
 * without a Supabase connection. See provider-usage-data.ts for the actual
 * read/write orchestration (migration 0005, the approved plan).
 */
export type ProviderName = "birdeye" | "helius";

/** Nested `{ [reason]: { [path]: count } }` — see error-classification.ts. Bounded by (a handful of reasons) x (a handful of endpoints), never per-request. */
export type RetryReasonCounts = Record<string, Record<string, number>>;

export interface ProviderUsageCounts {
  outboundAttempts?: number;
  successfulRequests?: number;
  retries?: number;
  cacheHits?: number;
  cacheMisses?: number;
  retryReasons?: RetryReasonCounts;
}

export interface StoredProviderUsage {
  outboundAttempts: number;
  successfulRequests: number;
  retries: number;
  cacheHits: number;
  cacheMisses: number;
  retryReasons: RetryReasonCounts;
}

/** Always UTC, deliberately never locale/timezone-dependent (never `toLocaleDateString()`). */
export function getUtcDateString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function emptyCounts(): StoredProviderUsage {
  return { outboundAttempts: 0, successfulRequests: 0, retries: 0, cacheHits: 0, cacheMisses: 0, retryReasons: {} };
}

function mergeRetryReasons(existing: RetryReasonCounts, increment: RetryReasonCounts | undefined): RetryReasonCounts {
  if (!increment || Object.keys(increment).length === 0) return existing;
  const merged: RetryReasonCounts = { ...existing };
  for (const [reason, pathCounts] of Object.entries(increment)) {
    const existingPathCounts = merged[reason] ?? {};
    const mergedPathCounts = { ...existingPathCounts };
    for (const [path, count] of Object.entries(pathCounts)) {
      mergedPathCounts[path] = (mergedPathCounts[path] ?? 0) + count;
    }
    merged[reason] = mergedPathCounts;
  }
  return merged;
}

/**
 * Merges an increment into an existing (or default-empty) count bucket.
 * Extracted so the in-memory fallback's accumulation logic is testable
 * independent of which branch (Supabase vs. memory) uses it.
 */
export function mergeCounts(existing: StoredProviderUsage | undefined, increment: ProviderUsageCounts): StoredProviderUsage {
  const base = existing ?? emptyCounts();
  return {
    outboundAttempts: base.outboundAttempts + (increment.outboundAttempts ?? 0),
    successfulRequests: base.successfulRequests + (increment.successfulRequests ?? 0),
    retries: base.retries + (increment.retries ?? 0),
    cacheHits: base.cacheHits + (increment.cacheHits ?? 0),
    cacheMisses: base.cacheMisses + (increment.cacheMisses ?? 0),
    retryReasons: mergeRetryReasons(base.retryReasons, increment.retryReasons),
  };
}
