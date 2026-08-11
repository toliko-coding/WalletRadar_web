import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { birdeyeWalletAnalytics } from "@/lib/providers/birdeye/wallet-analytics";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { traderTypeFromTags } from "@/lib/discovery/trader-type";
import { mergeDiscoveryHit, type CandidateWalletRecord, type DiscoveryHit } from "@/lib/discovery/merge-candidate";
import { assertNoError } from "@/lib/supabase/assert";

export interface DiscoverWalletsResult {
  tokensScanned: number;
  uniqueWalletsDiscovered: number;
  totalHits: number;
  errors: string[];
  persisted: boolean;
}

/**
 * System A, discovery half (§4/§23-26): active tokens -> their top traders ->
 * dedupe -> candidate pool. Runs against real Birdeye data every time it's
 * called; there's no cron wiring yet (see supabase/CRON.md) so this is
 * invoked manually via POST /api/jobs/discover-wallets for now.
 */
export async function runDiscoverWallets(
  opts: { trendingTokenLimit?: number; topTradersPerToken?: number } = {}
): Promise<DiscoverWalletsResult> {
  const trendingTokenLimit = opts.trendingTokenLimit ?? 10;
  const topTradersPerToken = opts.topTradersPerToken ?? 10;
  const startedAt = new Date();
  const supabase = getSupabaseServiceClient();

  const errors: string[] = [];
  const hits: DiscoveryHit[] = [];
  const tagsByWallet = new Map<string, string[]>();
  let tokensScanned = 0;

  try {
    const tokens = await birdeyeWalletAnalytics.getTrendingTokens(trendingTokenLimit);

    if (supabase && tokens.length > 0) {
      const tokensResult = await supabase
        .from("tokens")
        .upsert(
          tokens.map((t) => ({ mint: t.tokenMint, symbol: t.symbol })),
          { onConflict: "mint", ignoreDuplicates: true }
        );
      if (tokensResult.error) errors.push(`persisting tokens: ${tokensResult.error.message}`);
    }

    const discoveredAt = new Date().toISOString();
    for (const token of tokens) {
      try {
        const traders = await birdeyeWalletAnalytics.getTopTokenTraders(token.tokenMint, {
          timeFrame: "24h",
          limit: topTradersPerToken,
        });
        tokensScanned += 1;
        for (const trader of traders) {
          hits.push({
            walletAddress: trader.walletAddress,
            tokenMint: token.tokenMint,
            source: "trending_top_traders",
            discoveredAt,
          });
          tagsByWallet.set(trader.walletAddress, [
            ...(tagsByWallet.get(trader.walletAddress) ?? []),
            ...trader.tags,
          ]);
        }
      } catch (err) {
        errors.push(`top traders for ${token.symbol ?? token.tokenMint}: ${errorMessage(err)}`);
      }
    }
  } catch (err) {
    errors.push(`trending tokens: ${errorMessage(err)}`);
  }

  let persisted = false;
  if (supabase && hits.length > 0) {
    try {
      await persistDiscoveryHits(supabase, hits, tagsByWallet);
      persisted = true;
    } catch (err) {
      errors.push(`persisting discovery hits: ${errorMessage(err)}`);
    }
  }

  const completedAt = new Date();
  if (supabase) {
    await supabase.from("job_runs").insert({
      job_name: "discover-wallets",
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      status: errors.length === 0 ? "success" : hits.length > 0 ? "partial" : "failed",
      processed_items: hits.length,
      errors: errors.length > 0 ? errors : null,
      duration_ms: completedAt.getTime() - startedAt.getTime(),
    });
  }

  return {
    tokensScanned,
    uniqueWalletsDiscovered: tagsByWallet.size,
    totalHits: hits.length,
    errors,
    persisted,
  };
}

async function persistDiscoveryHits(
  supabase: SupabaseClient,
  hits: DiscoveryHit[],
  tagsByWallet: Map<string, string[]>
): Promise<void> {
  const uniqueAddresses = [...tagsByWallet.keys()];
  const now = new Date().toISOString();

  // Only set trader_type when discovery actually learned something —
  // omitting the field on an upsert leaves an existing (possibly
  // better-informed) value untouched instead of resetting it to unknown.
  // PostgREST's bulk upsert requires every row in one call to share the same
  // keys (PGRST102 "All object keys must match" otherwise, and supabase-js
  // does NOT throw on that — it comes back as `{ error }`, which silently
  // vanished here until assertNoError below started checking it), so rows
  // that do/don't carry trader_type must go in two separate calls, not one
  // array with some objects missing the key.
  const taggedWalletRows: Array<{ address: string; updated_at: string; trader_type: string }> = [];
  const untaggedWalletRows: Array<{ address: string; updated_at: string }> = [];
  for (const address of uniqueAddresses) {
    const traderType = traderTypeFromTags(tagsByWallet.get(address) ?? []);
    if (traderType !== "MANUAL_UNKNOWN") {
      taggedWalletRows.push({ address, updated_at: now, trader_type: traderType });
    } else {
      untaggedWalletRows.push({ address, updated_at: now });
    }
  }
  if (taggedWalletRows.length > 0) {
    const result = await supabase.from("wallets").upsert(taggedWalletRows, { onConflict: "address" });
    assertNoError(result, "upserting tagged wallets");
  }
  if (untaggedWalletRows.length > 0) {
    const result = await supabase.from("wallets").upsert(untaggedWalletRows, { onConflict: "address" });
    assertNoError(result, "upserting untagged wallets");
  }

  const { data: existingRows, error: selectError } = await supabase
    .from("candidate_wallets")
    .select(
      "wallet_address, first_discovered_at, last_discovered_at, discovery_source, number_of_discovery_hits, tokens_discovered_from, analysis_status, eligible, rejection_reason"
    )
    .in("wallet_address", uniqueAddresses);
  assertNoError({ error: selectError }, "reading existing candidate_wallets");

  const existingByAddress = new Map((existingRows ?? []).map((r) => [r.wallet_address as string, r]));

  const mergedByAddress = new Map<string, CandidateWalletRecord>();
  for (const hit of hits) {
    const dbRow = existingByAddress.get(hit.walletAddress);
    const current =
      mergedByAddress.get(hit.walletAddress) ??
      (dbRow
        ? ({
            walletAddress: dbRow.wallet_address as string,
            firstDiscoveredAt: dbRow.first_discovered_at as string,
            lastDiscoveredAt: dbRow.last_discovered_at as string,
            discoverySource: dbRow.discovery_source as string,
            numberOfDiscoveryHits: dbRow.number_of_discovery_hits as number,
            tokensDiscoveredFrom: (dbRow.tokens_discovered_from as string[] | null) ?? [],
          } satisfies CandidateWalletRecord)
        : null);
    mergedByAddress.set(hit.walletAddress, mergeDiscoveryHit(current, hit));
  }

  const candidateRows = [...mergedByAddress.values()].map((record) => {
    const dbRow = existingByAddress.get(record.walletAddress);
    return {
      wallet_address: record.walletAddress,
      first_discovered_at: record.firstDiscoveredAt,
      last_discovered_at: record.lastDiscoveredAt,
      discovery_source: record.discoverySource,
      number_of_discovery_hits: record.numberOfDiscoveryHits,
      tokens_discovered_from: record.tokensDiscoveredFrom,
      // Discovery only ever adds/refreshes sighting metadata — it never
      // touches analysis outcome fields for an already-known candidate.
      analysis_status: dbRow?.analysis_status ?? "pending",
      eligible: dbRow?.eligible ?? null,
      rejection_reason: dbRow?.rejection_reason ?? null,
      updated_at: now,
    };
  });
  const candidateResult = await supabase
    .from("candidate_wallets")
    .upsert(candidateRows, { onConflict: "wallet_address" });
  assertNoError(candidateResult, "upserting candidate_wallets");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
