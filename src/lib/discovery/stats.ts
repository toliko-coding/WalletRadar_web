import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

export interface DiscoveryStats {
  candidateWallets: number | null;
  analyzed: number | null;
  eligible: number | null;
  topTracked: number | null;
  lastDiscoveryScanAt: string | null;
  lastAnalysisRunAt: string | null;
}

const EMPTY_STATS: DiscoveryStats = {
  candidateWallets: null,
  analyzed: null,
  eligible: null,
  topTracked: null,
  lastDiscoveryScanAt: null,
  lastAnalysisRunAt: null,
};

/** Powers the /discover stat cards. Returns nulls (rendered as "—") when Supabase isn't configured. */
export async function getDiscoveryStats(): Promise<DiscoveryStats> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return EMPTY_STATS;

  const [candidateWallets, analyzed, eligible, lastDiscoveryRun, lastAnalysisRun] = await Promise.all([
    supabase.from("candidate_wallets").select("*", { count: "exact", head: true }),
    supabase.from("candidate_wallets").select("*", { count: "exact", head: true }).eq("analysis_status", "analyzed"),
    supabase.from("candidate_wallets").select("*", { count: "exact", head: true }).eq("eligible", true),
    supabase
      .from("job_runs")
      .select("completed_at")
      .eq("job_name", "discover-wallets")
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("job_runs")
      .select("completed_at")
      .eq("job_name", "analyze-candidate-wallets")
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const eligibleCount = eligible.count ?? 0;
  return {
    candidateWallets: candidateWallets.count ?? 0,
    analyzed: analyzed.count ?? 0,
    eligible: eligibleCount,
    topTracked: Math.min(eligibleCount, 10),
    lastDiscoveryScanAt: (lastDiscoveryRun.data?.completed_at as string | undefined) ?? null,
    lastAnalysisRunAt: (lastAnalysisRun.data?.completed_at as string | undefined) ?? null,
  };
}
