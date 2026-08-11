/**
 * Pure string builders for PostgREST's `.or()` filter syntax, extracted so
 * the null-passes-through semantics are testable without a live Supabase
 * client. A wallet with an UNAVAILABLE metric (e.g. max_drawdown_pct is
 * null on most rows today — Birdeye's pnl/chart is permission-gated on the
 * current API tier) must not be excluded by a filter on that metric; that
 * would silently hide almost the entire leaderboard. This mirrors
 * analyzeWallet()'s own eligibility check, which only rejects a wallet for
 * a metric it actually measured (src/lib/analysis/analyze-wallet.ts).
 */
export function nullableLteFilter(column: string, max: number): string {
  return `${column}.is.null,${column}.lte.${max}`;
}

export function nullableGteFilter(column: string, min: number): string {
  return `${column}.is.null,${column}.gte.${min}`;
}

/** Postgres array literal for a PostgREST `.not(column, "in", ...)` filter. */
export function inListLiteral(values: string[]): string {
  return `(${values.join(",")})`;
}
