/**
 * Pure scheduling/budget decision logic for the standalone automation
 * runner — no I/O, so unit-testable without a Supabase connection or a
 * real filesystem. See status-data.ts / automation/runner.ts for the
 * actual orchestration these decisions feed into.
 */

/**
 * Whether a job is due to run again — `now - lastRunAt >= intervalMinutes`.
 * `lastRunAt: null` (never run before) is always due immediately. This is
 * the ONLY thing that decides "due" — there is no missed-cycle counter, so
 * waking up after a long gap (Mac sleep, the app being closed) makes a job
 * due at most once, never a burst of catch-up runs.
 */
export function isJobDue(lastRunAt: string | null, intervalMinutes: number, now: Date = new Date()): boolean {
  if (lastRunAt === null) return true;
  const elapsedMinutes = (now.getTime() - new Date(lastRunAt).getTime()) / 60_000;
  return elapsedMinutes >= intervalMinutes;
}

/** For display only ("next planned cycle") — never stored, always derived from the last real run plus the currently-configured interval. Null when there's no last run to compute from (i.e. already due). */
export function computeNextDueAt(lastRunAt: string | null, intervalMinutes: number): string | null {
  if (lastRunAt === null) return null;
  return new Date(new Date(lastRunAt).getTime() + intervalMinutes * 60_000).toISOString();
}

/**
 * The expensive-job budget check (discovery/candidate-analysis only —
 * strategy ticks are never gated by this). A pre-job START gate, not a
 * mathematically hard daily cap: checked once before a prospective
 * expensive job begins, not enforced mid-job. An already-authorized job
 * that's already running can still push the day's total past the budget
 * before the *next* prospective expensive job is blocked — accepted,
 * documented v1 behavior, not a bug.
 */
export function shouldStartExpensiveJob(todayBirdeyeOutboundAttempts: number, dailyBudget: number): boolean {
  return todayBirdeyeOutboundAttempts < dailyBudget;
}

/**
 * Loopback-only validation for the runner's API base URL — accepts only
 * hosts that resolve to the local machine. Rejects everything else,
 * including any hostname that could resolve to a remote address. `[::1]`
 * (bracketed IPv6 URL form) is normalized before comparison.
 */
export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}
