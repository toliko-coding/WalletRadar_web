import { describe, expect, it, vi } from "vitest";
import { runOneTickCheck, runOneMaintenanceCheck, runOneHeartbeatPing, type LoopDeps, type RunnerIdentity } from "../automation/loops";
import type { AutomationConfig } from "../automation/config";
import type { AutomationStatus } from "@/lib/automation/status-data";

const IDENTITY: RunnerIdentity = { runnerId: "runner-1", pid: 123, startedAt: "2026-09-14T00:00:00Z" };

function config(overrides: Partial<AutomationConfig> = {}): AutomationConfig {
  return {
    apiBaseUrl: "http://127.0.0.1:3000",
    jobSecret: "secret",
    tickIntervalMinutes: 15,
    discoveryIntervalHours: 6,
    analyzeIntervalHours: 6,
    analyzeBatchSize: 10,
    expensiveJobDailyBudget: 500,
    pollIntervalSeconds: 60,
    analyzeRefreshIntervalHours: 24,
    analyzeRefreshBatchSize: 10,
    analyzeRefreshStalenessHours: 24,
    discoveryBacklogHighWaterMark: 500,
    budgetRefreshReserveThreshold: 400,
    ...overrides,
  };
}

function status(overrides: Partial<AutomationStatus> = {}): AutomationStatus {
  return {
    heartbeat: null,
    todayProviderUsage: [{ provider: "birdeye", usage: { outboundAttempts: 0, successfulRequests: 0, retries: 0, cacheHits: 0, cacheMisses: 0, retryReasons: {} } }],
    recentJobRuns: [],
    lastJobRunAt: { tick: null, discovery: null, analyze: null, analyzeRefresh: null },
    activeStrategies: [],
    pendingCandidateBacklog: 0,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<LoopDeps> = {}): LoopDeps {
  return {
    fetchStatus: vi.fn().mockResolvedValue(status()),
    postJob: vi.fn().mockResolvedValue({}),
    postHeartbeat: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    ...overrides,
  };
}

describe("runOneTickCheck", () => {
  it("does not call postJob when the tick isn't due yet", async () => {
    const deps = makeDeps({ fetchStatus: vi.fn().mockResolvedValue(status({ lastJobRunAt: { tick: new Date().toISOString(), discovery: null, analyze: null, analyzeRefresh: null } })) });
    await runOneTickCheck(config(), IDENTITY, deps);
    expect(deps.postJob).not.toHaveBeenCalled();
  });

  it("calls the tick route and reports a successful heartbeat when due", async () => {
    const deps = makeDeps();
    await runOneTickCheck(config(), IDENTITY, deps);
    expect(deps.postJob).toHaveBeenCalledWith(expect.anything(), "/api/jobs/tick-active-strategies");
    expect(deps.postHeartbeat).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cycleCompleted: { status: "success" } }));
  });

  it("reports a failed heartbeat (not success) when postJob throws, and does not crash", async () => {
    const deps = makeDeps({ postJob: vi.fn().mockRejectedValue(new Error("Next.js unreachable")) });
    await runOneTickCheck(config(), IDENTITY, deps);
    expect(deps.postHeartbeat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cycleCompleted: { status: "failed", error: "Next.js unreachable" } })
    );
  });

  it("propagates a fetchStatus failure to the caller (an attempted check, not a successful run)", async () => {
    const deps = makeDeps({ fetchStatus: vi.fn().mockRejectedValue(new Error("connection refused")) });
    await expect(runOneTickCheck(config(), IDENTITY, deps)).rejects.toThrow("connection refused");
    expect(deps.postJob).not.toHaveBeenCalled();
  });
});

describe("runOneMaintenanceCheck — independence from the tick check", () => {
  it("a slow maintenance postJob does not prevent a concurrent tick check from completing", async () => {
    let resolveMaintenance!: (value: Record<string, unknown>) => void;
    const maintenancePostJob = vi.fn(() => new Promise<Record<string, unknown>>((resolve) => { resolveMaintenance = resolve; }));
    const maintenanceDeps = makeDeps({ postJob: maintenancePostJob });
    const tickDeps = makeDeps();

    // Start the "slow" maintenance check but do not await it yet.
    const maintenancePromise = runOneMaintenanceCheck(config(), IDENTITY, maintenanceDeps);

    // The tick check, on its own independent call, completes immediately —
    // it never awaits the maintenance promise, proving these are separate
    // chains, not nested awaits (the exact bug this phase fixes).
    await runOneTickCheck(config(), IDENTITY, tickDeps);
    expect(tickDeps.postJob).toHaveBeenCalledWith(expect.anything(), "/api/jobs/tick-active-strategies");

    // Only now let the "long" maintenance job finish.
    resolveMaintenance({});
    await maintenancePromise;
    expect(maintenancePostJob).toHaveBeenCalledTimes(1);
  });
});

describe("runOneMaintenanceCheck — priority REFRESH > EXPLORATION > DISCOVERY", () => {
  it("picks refresh when all three are due and budget-eligible, calling postJob exactly once", async () => {
    const deps = makeDeps();
    await runOneMaintenanceCheck(config(), IDENTITY, deps); // all lastJobRunAt null -> all due
    expect(deps.postJob).toHaveBeenCalledTimes(1);
    expect(deps.postJob).toHaveBeenCalledWith(expect.anything(), "/api/jobs/analyze-refresh-wallets", expect.any(Object));
  });

  it("picks exploration when refresh is not due but exploration and discovery are", async () => {
    const recentlyDone = new Date().toISOString();
    const deps = makeDeps({
      fetchStatus: vi.fn().mockResolvedValue(status({ lastJobRunAt: { tick: null, discovery: null, analyze: null, analyzeRefresh: recentlyDone } })),
    });
    await runOneMaintenanceCheck(config(), IDENTITY, deps);
    expect(deps.postJob).toHaveBeenCalledTimes(1);
    expect(deps.postJob).toHaveBeenCalledWith(expect.anything(), "/api/jobs/analyze-candidates", expect.any(Object));
  });

  it("picks discovery only when neither refresh nor exploration is due", async () => {
    const recentlyDone = new Date().toISOString();
    const deps = makeDeps({
      fetchStatus: vi.fn().mockResolvedValue(status({ lastJobRunAt: { tick: null, discovery: null, analyze: recentlyDone, analyzeRefresh: recentlyDone } })),
    });
    await runOneMaintenanceCheck(config(), IDENTITY, deps);
    expect(deps.postJob).toHaveBeenCalledTimes(1);
    expect(deps.postJob).toHaveBeenCalledWith(expect.anything(), "/api/jobs/discover-wallets", undefined);
  });

  it("calls postJob zero times when nothing is due", async () => {
    const recentlyDone = new Date().toISOString();
    const deps = makeDeps({
      fetchStatus: vi.fn().mockResolvedValue(status({ lastJobRunAt: { tick: null, discovery: recentlyDone, analyze: recentlyDone, analyzeRefresh: recentlyDone } })),
    });
    await runOneMaintenanceCheck(config(), IDENTITY, deps);
    expect(deps.postJob).not.toHaveBeenCalled();
  });

  it("after a simulated long gap (everything due at once), still calls postJob exactly once this iteration — no catch-up burst", async () => {
    const deps = makeDeps(); // all null -> all "due forever" but only one attempted
    await runOneMaintenanceCheck(config(), IDENTITY, deps);
    expect(deps.postJob).toHaveBeenCalledTimes(1);
  });
});

describe("runOneMaintenanceCheck — discovery backlog gate", () => {
  it("skips discovery when the backlog is at the high-water mark, even though discovery is due", async () => {
    const recentlyDone = new Date().toISOString();
    const deps = makeDeps({
      fetchStatus: vi.fn().mockResolvedValue(
        status({
          lastJobRunAt: { tick: null, discovery: null, analyze: recentlyDone, analyzeRefresh: recentlyDone },
          pendingCandidateBacklog: 500,
        })
      ),
    });
    await runOneMaintenanceCheck(config({ discoveryBacklogHighWaterMark: 500 }), IDENTITY, deps);
    expect(deps.postJob).not.toHaveBeenCalled();
  });

  it("exploration and refresh remain eligible even when discovery's backlog gate is active", async () => {
    const deps = makeDeps({
      fetchStatus: vi.fn().mockResolvedValue(status({ pendingCandidateBacklog: 999 })), // way over any reasonable mark; refresh still due (null)
    });
    await runOneMaintenanceCheck(config({ discoveryBacklogHighWaterMark: 500 }), IDENTITY, deps);
    // refresh wins priority regardless of the backlog gate, which only ever affects discovery.
    expect(deps.postJob).toHaveBeenCalledWith(expect.anything(), "/api/jobs/analyze-refresh-wallets", expect.any(Object));
  });
});

describe("runOneMaintenanceCheck — provider budget tiers", () => {
  it("below the reserve threshold: all three types are eligible (priority still picks refresh)", async () => {
    const deps = makeDeps({ fetchStatus: vi.fn().mockResolvedValue(status({ todayProviderUsage: [{ provider: "birdeye", usage: { outboundAttempts: 399, successfulRequests: 0, retries: 0, cacheHits: 0, cacheMisses: 0, retryReasons: {} } }] })) });
    await runOneMaintenanceCheck(config(), IDENTITY, deps);
    expect(deps.postJob).toHaveBeenCalledWith(expect.anything(), "/api/jobs/analyze-refresh-wallets", expect.any(Object));
  });

  it("in the reserve band (400-499): only refresh is eligible, even if exploration/discovery are due and refresh is not", async () => {
    const recentlyDone = new Date().toISOString();
    const deps = makeDeps({
      fetchStatus: vi.fn().mockResolvedValue(
        status({
          lastJobRunAt: { tick: null, discovery: null, analyze: null, analyzeRefresh: recentlyDone },
          todayProviderUsage: [{ provider: "birdeye", usage: { outboundAttempts: 450, successfulRequests: 0, retries: 0, cacheHits: 0, cacheMisses: 0, retryReasons: {} } }],
        })
      ),
    });
    await runOneMaintenanceCheck(config(), IDENTITY, deps);
    // refresh isn't due, and exploration/discovery aren't eligible in this tier -> nothing runs.
    expect(deps.postJob).not.toHaveBeenCalled();
  });

  it("at/above the daily budget: nothing runs, even refresh", async () => {
    const deps = makeDeps({ fetchStatus: vi.fn().mockResolvedValue(status({ todayProviderUsage: [{ provider: "birdeye", usage: { outboundAttempts: 500, successfulRequests: 0, retries: 0, cacheHits: 0, cacheMisses: 0, retryReasons: {} } }] })) });
    await runOneMaintenanceCheck(config(), IDENTITY, deps);
    expect(deps.postJob).not.toHaveBeenCalled();
  });

  it("strategy ticks are never gated by the provider budget, even at/above the daily budget", async () => {
    const deps = makeDeps({ fetchStatus: vi.fn().mockResolvedValue(status({ todayProviderUsage: [{ provider: "birdeye", usage: { outboundAttempts: 999, successfulRequests: 0, retries: 0, cacheHits: 0, cacheMisses: 0, retryReasons: {} } }] })) });
    await runOneTickCheck(config(), IDENTITY, deps);
    expect(deps.postJob).toHaveBeenCalledWith(expect.anything(), "/api/jobs/tick-active-strategies");
  });
});

describe("runOneMaintenanceCheck — lockSkipped is not a successful run", () => {
  it("reports a 'skipped' heartbeat, distinct from 'success', when the response says lockSkipped", async () => {
    const deps = makeDeps({ postJob: vi.fn().mockResolvedValue({ lockSkipped: true }) });
    await runOneMaintenanceCheck(config(), IDENTITY, deps);
    expect(deps.postHeartbeat).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cycleCompleted: { status: "skipped" } }));
  });

  it("reports 'success' (not 'skipped') for a genuine completion, including a real zero-work result", async () => {
    const deps = makeDeps({ postJob: vi.fn().mockResolvedValue({ processed: 0, succeeded: 0, failed: 0, errors: [] }) });
    await runOneMaintenanceCheck(config(), IDENTITY, deps);
    expect(deps.postHeartbeat).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cycleCompleted: { status: "success" } }));
  });

  it("reports 'failed' (not 'success' or 'skipped') when the maintenance job's HTTP call itself throws", async () => {
    const deps = makeDeps({ postJob: vi.fn().mockRejectedValue(new Error("timeout")) });
    await runOneMaintenanceCheck(config(), IDENTITY, deps);
    expect(deps.postHeartbeat).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cycleCompleted: { status: "failed", error: "timeout" } }));
  });
});

describe("runOneMaintenanceCheck — failure isolation", () => {
  it("a postJob failure does not throw out of the function — the loop wrapper stays alive", async () => {
    const deps = makeDeps({ postJob: vi.fn().mockRejectedValue(new Error("boom")) });
    await expect(runOneMaintenanceCheck(config(), IDENTITY, deps)).resolves.toBeUndefined();
  });

  it("propagates a fetchStatus failure to the caller, same as the tick check", async () => {
    const deps = makeDeps({ fetchStatus: vi.fn().mockRejectedValue(new Error("db down")) });
    await expect(runOneMaintenanceCheck(config(), IDENTITY, deps)).rejects.toThrow("db down");
  });
});

describe("runOneHeartbeatPing", () => {
  it("posts a bare liveness ping with no cycleCompleted field", async () => {
    const deps = makeDeps();
    await runOneHeartbeatPing(config(), IDENTITY, deps);
    expect(deps.postHeartbeat).toHaveBeenCalledTimes(1);
    const [, payload] = (deps.postHeartbeat as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.cycleCompleted).toBeUndefined();
  });

  it("propagates a postHeartbeat failure to the caller (the loop wrapper logs and retries next poll)", async () => {
    const deps = makeDeps({ postHeartbeat: vi.fn().mockRejectedValue(new Error("unreachable")) });
    await expect(runOneHeartbeatPing(config(), IDENTITY, deps)).rejects.toThrow("unreachable");
  });
});
