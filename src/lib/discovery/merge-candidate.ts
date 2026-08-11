export interface CandidateWalletRecord {
  walletAddress: string;
  firstDiscoveredAt: string;
  lastDiscoveredAt: string;
  discoverySource: string;
  numberOfDiscoveryHits: number;
  tokensDiscoveredFrom: string[];
}

export interface DiscoveryHit {
  walletAddress: string;
  tokenMint: string;
  source: string;
  discoveredAt: string; // ISO timestamp
}

/**
 * Pure merge logic for a new discovery sighting of a wallet (§5). Kept
 * separate from the Supabase upsert so it's unit-testable without a DB:
 * hits always increment (a rough "how many times we've seen this wallet"
 * signal), tokensDiscoveredFrom is deduplicated, first_discovered_at is
 * preserved once set, and last_discovered_at only ever moves forward even if
 * hits arrive out of order within a batch.
 */
export function mergeDiscoveryHit(
  existing: CandidateWalletRecord | null,
  hit: DiscoveryHit
): CandidateWalletRecord {
  if (!existing) {
    return {
      walletAddress: hit.walletAddress,
      firstDiscoveredAt: hit.discoveredAt,
      lastDiscoveredAt: hit.discoveredAt,
      discoverySource: hit.source,
      numberOfDiscoveryHits: 1,
      tokensDiscoveredFrom: [hit.tokenMint],
    };
  }

  const tokensDiscoveredFrom = existing.tokensDiscoveredFrom.includes(hit.tokenMint)
    ? existing.tokensDiscoveredFrom
    : [...existing.tokensDiscoveredFrom, hit.tokenMint];

  return {
    ...existing,
    lastDiscoveredAt:
      new Date(hit.discoveredAt) > new Date(existing.lastDiscoveredAt)
        ? hit.discoveredAt
        : existing.lastDiscoveredAt,
    numberOfDiscoveryHits: existing.numberOfDiscoveryHits + 1,
    tokensDiscoveredFrom,
  };
}
