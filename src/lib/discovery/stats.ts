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

export interface JobRunRecord {
  jobName: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  processedItems: number;
  durationMs: number | null;
  errors: string[] | null;
}

/** Powers a job-run history view — previously only the single latest timestamp per job was visible anywhere, even though every run (with its errors) has been recorded in job_runs all along. */
export async function getRecentJobRuns(limit = 15): Promise<JobRunRecord[]> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("job_runs")
    .select("job_name, started_at, completed_at, status, processed_items, duration_ms, errors")
    .order("started_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    jobName: row.job_name as string,
    startedAt: row.started_at as string,
    completedAt: row.completed_at as string | null,
    status: row.status as string,
    processedItems: (row.processed_items as number) ?? 0,
    durationMs: row.duration_ms as number | null,
    errors: row.errors as string[] | null,
  }));
}
