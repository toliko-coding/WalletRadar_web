/**
 * Pure event identity/deduplication logic for Signal / Strategy Validation.
 * No I/O — takes already-fetched candidate events and a new detection,
 * decides whether they're "the same" real-world convergence occurrence, and
 * computes the merged fields if so. See the approved plan §B for the full
 * rationale and named edge cases.
 */

export interface EventWalletEntry {
  walletAddress: string;
  smartScore: number | null;
  usdValue: number | null;
  occurredAt: string; // ISO
}

export interface ExistingEventSummary {
  id: string;
  tokenMint: string;
  signalTime: string; // ISO
  triggeringWallets: EventWalletEntry[];
}

export interface NewDetection {
  tokenMint: string;
  signalTime: string; // ISO
  wallets: EventWalletEntry[];
}

/**
 * A rolling convergence window can shift signal_time tick to tick for what's
 * arguably one continuous accumulation story. This tolerance absorbs small
 * drift; it does not fully solve the ambiguity for a long-running
 * accumulation spanning more than this — that's a named, accepted
 * limitation (plan §B), not a bug.
 */
export const EVENT_MATCH_TOLERANCE_MINUTES = 60;

/**
 * Finds the existing event this detection should merge into, if any.
 * Deterministic: matches must share `tokenMint` and have a `signalTime`
 * within tolerance; ties (more than one candidate within tolerance) are
 * broken by picking the closest `signalTime`.
 */
export function findMatchingEvent(
  candidates: ExistingEventSummary[],
  detection: NewDetection,
  toleranceMinutes = EVENT_MATCH_TOLERANCE_MINUTES
): ExistingEventSummary | null {
  const detectionMs = new Date(detection.signalTime).getTime();
  const toleranceMs = toleranceMinutes * 60_000;

  const matches = candidates.filter(
    (c) => c.tokenMint === detection.tokenMint && Math.abs(new Date(c.signalTime).getTime() - detectionMs) <= toleranceMs
  );
  if (matches.length === 0) return null;

  return matches.sort(
    (a, b) => Math.abs(new Date(a.signalTime).getTime() - detectionMs) - Math.abs(new Date(b.signalTime).getTime() - detectionMs)
  )[0];
}

export interface MergedEventFields {
  signalTime: string; // ISO
  triggeringWallets: EventWalletEntry[];
  walletCount: number;
  minSmartScore: number | null;
  maxSmartScore: number | null;
  avgSmartScore: number | null;
}

/**
 * Merge rule (plan §B): union wallets by address, keeping each wallet's
 * earliest known `occurredAt`; `signalTime` moves to the earlier of the two
 * (correcting toward an earlier true timestamp is not look-ahead — it
 * doesn't change any decision, just completes the record); min/max/avg
 * Smart Score are recomputed from the merged union.
 */
export function mergeEventWallets(existing: ExistingEventSummary, detection: NewDetection): MergedEventFields {
  const byWallet = new Map<string, EventWalletEntry>();
  for (const w of existing.triggeringWallets) byWallet.set(w.walletAddress, w);
  for (const w of detection.wallets) {
    const prior = byWallet.get(w.walletAddress);
    if (!prior || new Date(w.occurredAt).getTime() < new Date(prior.occurredAt).getTime()) {
      byWallet.set(w.walletAddress, w);
    }
  }

  const triggeringWallets = [...byWallet.values()];
  const scores = triggeringWallets.map((w) => w.smartScore).filter((s): s is number => s !== null);

  const signalTime = new Date(
    Math.min(new Date(existing.signalTime).getTime(), new Date(detection.signalTime).getTime())
  ).toISOString();

  return {
    signalTime,
    triggeringWallets,
    walletCount: triggeringWallets.length,
    minSmartScore: scores.length > 0 ? Math.min(...scores) : null,
    maxSmartScore: scores.length > 0 ? Math.max(...scores) : null,
    avgSmartScore: scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : null,
  };
}

/** Fields for a brand-new event created from a first-ever detection (no merge). */
export function newEventFields(detection: NewDetection): MergedEventFields {
  const scores = detection.wallets.map((w) => w.smartScore).filter((s): s is number => s !== null);
  return {
    signalTime: detection.signalTime,
    triggeringWallets: detection.wallets,
    walletCount: detection.wallets.length,
    minSmartScore: scores.length > 0 ? Math.min(...scores) : null,
    maxSmartScore: scores.length > 0 ? Math.max(...scores) : null,
    avgSmartScore: scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : null,
  };
}
