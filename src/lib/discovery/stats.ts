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

/**
 * The last completed run of a specific job, regardless of how many other
 * job types have run more recently. Deliberately NOT derived from
 * getRecentJobRuns()'s generic top-N-across-all-job-types list — at a
 * 15-minute tick cadence, ticks alone would push a 6-hourly discovery/
 * analyze run out of even a fairly generous top-N window within a few
 * hours, making a due-state check built on that list wrongly conclude
 * "never run." Used by the automation runner's isJobDue() checks
 * (src/lib/automation/scheduling.ts), one call per job type.
 */
export async function getLastJobRunAt(jobName: string): Promise<string | null> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("job_runs")
    .select("completed_at")
    .eq("job_name", jobName)
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  return (data?.completed_at as string | undefined) ?? null;
}

/**
 * The discovery backlog gate's input (Corrective Phase v2, Objective 2/§4)
 * — exactly the same population `analyze-candidate-wallets`' exploration
 * lane already selects from (`pending` = never analyzed, `failed` = a prior
 * attempt errored and still needs retrying; `analyzing` is transient/
 * in-progress, `analyzed` is resolved, neither counts as backlog). Pure
 * operational flow control: never deletes wallets, never changes a score or
 * `analysis_status` itself.
 */
export async function getPendingCandidateBacklogCount(): Promise<number> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return 0;

  const { count } = await supabase
    .from("candidate_wallets")
    .select("*", { count: "exact", head: true })
    .in("analysis_status", ["pending", "failed"]);

  return count ?? 0;
}

export interface JobRunOverview {
  /** Most recent completed run of ANY outcome — same value getLastJobRunAt returns, plus its status, for display. */
  lastCompletedAt: string | null;
  lastStatus: string | null;
  /** Most recent run whose status was specifically 'success' — may be older than lastCompletedAt if the latest attempt was 'partial'/'failed'. Null if no successful run is on record. */
  lastSuccessfulAt: string | null;
}

const EMPTY_JOB_RUN_OVERVIEW: JobRunOverview = { lastCompletedAt: null, lastStatus: null, lastSuccessfulAt: null };

/**
 * Richer per-job-type display data for /settings' Automation panel
 * (Corrective Phase v2 checkpoint 5) — separate from getLastJobRunAt
 * (unchanged, still the runner's own due-state source of truth) so this
 * purely additive read can never affect scheduling. Two targeted queries
 * (not the generic top-N getRecentJobRuns list, for the same flooding
 * reason getLastJobRunAt's own doc comment explains) — cheap Supabase
 * reads, zero provider calls.
 */
export async function getJobRunOverview(jobName: string): Promise<JobRunOverview> {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return EMPTY_JOB_RUN_OVERVIEW;

  const [latest, latestSuccess] = await Promise.all([
    supabase
      .from("job_runs")
      .select("completed_at, status")
      .eq("job_name", jobName)
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("job_runs")
      .select("completed_at")
      .eq("job_name", jobName)
      .eq("status", "success")
      .order("completed_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    lastCompletedAt: (latest.data?.completed_at as string | undefined) ?? null,
    lastStatus: (latest.data?.status as string | undefined) ?? null,
    lastSuccessfulAt: (latestSuccess.data?.completed_at as string | undefined) ?? null,
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
