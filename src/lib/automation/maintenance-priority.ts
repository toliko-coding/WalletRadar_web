/**
 * Pure scheduling logic for the runner's single serialized maintenanceLoop
 * (Corrective Phase v2, Objective 1/2) — no I/O, unit-testable without a
 * Supabase connection. Deliberately separate from scheduling.ts's existing
 * `shouldStartExpensiveJob` (still used, unchanged, by AutomationPanel until
 * the /settings checkpoint) — these are the NEW tiered/prioritized
 * decisions the maintenanceLoop itself uses.
 */

export type MaintenanceJobType = "refresh" | "exploration" | "discovery";

/** Fixed priority order: REFRESH > EXPLORATION > DISCOVERY, per the approved plan. */
export const MAINTENANCE_PRIORITY: readonly MaintenanceJobType[] = ["refresh", "exploration", "discovery"];

/**
 * Given the set of maintenance job types that are BOTH due AND otherwise
 * eligible (budget tier, backlog gate already applied by the caller), picks
 * the single highest-priority one to run this iteration — or `null` if
 * none are eligible. The maintenanceLoop calls postJob for at most this one
 * job per iteration; whichever isn't picked simply gets reconsidered next
 * iteration, never both attempted at once.
 */
export function pickMaintenanceJob(eligible: ReadonlySet<MaintenanceJobType>): MaintenanceJobType | null {
  for (const job of MAINTENANCE_PRIORITY) {
    if (eligible.has(job)) return job;
  }
  return null;
}

/**
 * Tiered provider-budget allocation (Corrective Phase v2 §6) — replaces a
 * flat "expensive jobs allowed: yes/no" gate with three bands, so refresh
 * (cheap, directly supports convergence evidence) isn't starved by
 * discovery/exploration consuming the whole budget first:
 *
 *   usage <  reserveThreshold        -> refresh + exploration + discovery
 *   reserveThreshold <= usage < budget -> refresh only
 *   usage >= budget                   -> nothing (strategy ticks still run — never gated by this)
 *
 * `budget` is still a conservative self-imposed operational safety value,
 * NOT a representation of Birdeye's actual account quota (unchanged
 * framing from the original Automatic Evidence Collection phase).
 */
export function classifyBudgetTier(
  todayBirdeyeOutboundAttempts: number,
  reserveThreshold: number,
  dailyBudget: number
): ReadonlySet<MaintenanceJobType> {
  if (todayBirdeyeOutboundAttempts >= dailyBudget) return new Set();
  if (todayBirdeyeOutboundAttempts >= reserveThreshold) return new Set(["refresh"]);
  return new Set(["refresh", "exploration", "discovery"]);
}

/**
 * The discovery backlog gate (Corrective Phase v2 §4) — pure operational
 * flow control, never touches a wallet's score/eligibility/analysis_status
 * itself. `pendingCandidateBacklog` is the same population exploration
 * already selects from (`analysis_status IN ('pending','failed')` — see
 * getPendingCandidateBacklogCount). Exploration and refresh are never
 * affected by this gate; only discovery is suppressed for the cycle.
 */
export function isDiscoveryBacklogBlocked(pendingCandidateBacklog: number, highWaterMark: number): boolean {
  return pendingCandidateBacklog >= highWaterMark;
}
