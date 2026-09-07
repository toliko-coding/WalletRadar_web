import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export interface ScoreHistoryPoint {
  snapshotAt: string;
  smartScore: number;
}

/** Powers the Smart Score history chart on /wallet/[address] (§44/§57). Empty when Supabase isn't configured or this is the wallet's first analysis. */
export async function getScoreHistory(
  walletAddress: string,
  windowLabel = "90D",
  limit = 60
): Promise<ScoreHistoryPoint[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("wallet_metric_history")
    .select("smart_score, snapshot_at")
    .eq("wallet_address", walletAddress)
    .eq("window_label", windowLabel)
    .not("smart_score", "is", null)
    .order("snapshot_at", { ascending: true })
    .limit(limit);

  return (data ?? []).map((row) => ({
    snapshotAt: row.snapshot_at as string,
    smartScore: row.smart_score as number,
  }));
}
