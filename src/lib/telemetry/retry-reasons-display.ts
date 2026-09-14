import type { RetryReasonCounts } from "./provider-usage";

export interface RetryReasonRow {
  reason: string;
  path: string;
  count: number;
}

/**
 * Flattens the nested `{ [reason]: { [path]: count } }` telemetry
 * (migration 0008) into a flat, sorted list for a compact /settings
 * display — pure, unit-testable. Sorted by count descending (the reasons/
 * endpoints worth looking at first), then alphabetically for a stable tie-
 * break. Bounded by construction (a handful of reason categories x a
 * handful of Birdeye endpoints), so no separate truncation/paging needed.
 */
export function flattenRetryReasons(retryReasons: RetryReasonCounts): RetryReasonRow[] {
  const rows: RetryReasonRow[] = [];
  for (const [reason, pathCounts] of Object.entries(retryReasons)) {
    for (const [path, count] of Object.entries(pathCounts)) {
      rows.push({ reason, path, count });
    }
  }
  return rows.sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason) || a.path.localeCompare(b.path));
}
