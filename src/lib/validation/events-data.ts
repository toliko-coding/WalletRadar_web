import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";
import { assertNoError } from "@/lib/supabase/assert";
import {
  findMatchingEvent,
  mergeEventWallets,
  newEventFields,
  EVENT_MATCH_TOLERANCE_MINUTES,
  type EventWalletEntry,
  type ExistingEventSummary,
  type NewDetection,
} from "./event-matching";

export interface ResolvedEvent {
  id: string;
  signalTime: string;
}

/**
 * Resolves the canonical `convergence_events` row for a freshly detected
 * signal — merging into an existing event within tolerance (plan §B), or
 * creating a new one. Pure Supabase reads/writes only; never calls a price
 * provider, so this costs nothing against Birdeye/Helius quota regardless
 * of how many strategies or ticks call it.
 */
export async function resolveOrCreateEvent(
  detection: NewDetection,
  tokenSymbol: string | null,
  marketPriceAtDetection: number | null
): Promise<ResolvedEvent | null> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return null;

  const toleranceMs = EVENT_MATCH_TOLERANCE_MINUTES * 60_000;
  const detectionTimeMs = new Date(detection.signalTime).getTime();
  const from = new Date(detectionTimeMs - toleranceMs).toISOString();
  const to = new Date(detectionTimeMs + toleranceMs).toISOString();

  const { data: candidateRows } = await supabase
    .from("convergence_events")
    .select("id, token_mint, signal_time, triggering_wallets, market_price_at_first_detection")
    .eq("token_mint", detection.tokenMint)
    .gte("signal_time", from)
    .lte("signal_time", to);

  const rows = candidateRows ?? [];
  const candidates: ExistingEventSummary[] = rows.map((r) => ({
    id: r.id as string,
    tokenMint: r.token_mint as string,
    signalTime: r.signal_time as string,
    triggeringWallets: (r.triggering_wallets as EventWalletEntry[]) ?? [],
  }));

  const match = findMatchingEvent(candidates, detection);

  if (!match) {
    const fields = newEventFields(detection);
    const insertResult = await supabase
      .from("convergence_events")
      .insert({
        token_mint: detection.tokenMint,
        token_symbol: tokenSymbol,
        signal_time: fields.signalTime,
        triggering_wallets: fields.triggeringWallets,
        wallet_count: fields.walletCount,
        min_smart_score: fields.minSmartScore,
        max_smart_score: fields.maxSmartScore,
        avg_smart_score: fields.avgSmartScore,
        market_price_at_first_detection: marketPriceAtDetection,
      })
      .select("id, signal_time")
      .single();
    assertNoError(insertResult, "creating convergence event");
    const row = insertResult.data as { id: string; signal_time: string };
    return { id: row.id, signalTime: row.signal_time };
  }

  const merged = mergeEventWallets(match, detection);
  // Never overwrite a real captured price with null, but backfill a
  // previously-missing one if this detection happens to have one.
  const existingRow = rows.find((r) => r.id === match.id) as { market_price_at_first_detection: number | null } | undefined;
  const marketPrice = existingRow?.market_price_at_first_detection ?? marketPriceAtDetection;

  const updateResult = await supabase
    .from("convergence_events")
    .update({
      signal_time: merged.signalTime,
      triggering_wallets: merged.triggeringWallets,
      wallet_count: merged.walletCount,
      min_smart_score: merged.minSmartScore,
      max_smart_score: merged.maxSmartScore,
      avg_smart_score: merged.avgSmartScore,
      market_price_at_first_detection: marketPrice,
      updated_at: new Date().toISOString(),
    })
    .eq("id", match.id);
  assertNoError(updateResult, "merging convergence event");

  return { id: match.id, signalTime: merged.signalTime };
}
