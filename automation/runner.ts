/**
 * The automation poll-loop — runs as a detached child process spawned by
 * cli.ts, entirely outside the Next.js app's own lifecycle (import
 * "server-only" genuinely throws when this project's business-logic
 * modules are imported outside Next's bundler — verified this session —
 * so this process only ever talks to the app over HTTP, reusing the
 * existing job/automation routes rather than duplicating any trading or
 * validation logic itself).
 *
 * Never fabricates progress: every "is X due" decision is re-derived fresh
 * from the server's own persisted state (job_runs, via
 * /api/automation/status) at the start of every cycle — this process keeps
 * no authoritative memory of its own about what it did last, so a crash,
 * a Mac sleep, or the Next.js server being briefly unreachable can never
 * cause a burst of catch-up runs or a false "already done" skip.
 */
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadAutomationConfig, type AutomationConfig } from "./config";
import { fetchStatus, postJob, postHeartbeat } from "./api-client";
import { removeLockFile } from "./lock-file";
import { isJobDue, shouldStartExpensiveJob } from "@/lib/automation/scheduling";

// .env.local is outside Next.js's own env-loading pipeline for this
// standalone process — must be loaded explicitly. Native to Node 20.6+/22
// (this project already targets Node 22 — see README), no extra
// dependency needed.
process.loadEnvFile(resolve(process.cwd(), ".env.local"));

const runnerId = process.env.WALLETRADAR_RUNNER_ID ?? randomUUID();
const startedAt = process.env.WALLETRADAR_RUNNER_STARTED_AT ?? new Date().toISOString();

let shutdownRequested = false;
let currentSleepResolve: (() => void) | null = null;

function log(message: string): void {
  console.log(`[automation ${new Date().toISOString()}] ${message}`);
}

function interruptibleSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    currentSleepResolve = resolve;
    setTimeout(() => {
      currentSleepResolve = null;
      resolve();
    }, ms);
  });
}

function requestShutdown(signal: string): void {
  log(`received ${signal}, finishing the current cycle (if any) and shutting down gracefully — never force-killing in-flight work`);
  shutdownRequested = true;
  if (currentSleepResolve) {
    const wake = currentSleepResolve;
    currentSleepResolve = null;
    wake();
  }
}

process.on("SIGTERM", () => requestShutdown("SIGTERM"));
process.on("SIGINT", () => requestShutdown("SIGINT"));

function heartbeatConfig(config: AutomationConfig) {
  return {
    tickIntervalMinutes: config.tickIntervalMinutes,
    discoveryIntervalHours: config.discoveryIntervalHours,
    analyzeIntervalHours: config.analyzeIntervalHours,
    analyzeBatchSize: config.analyzeBatchSize,
    expensiveJobDailyBudget: config.expensiveJobDailyBudget,
  };
}

/**
 * One poll iteration: fetch fresh status, decide what's due, run whatever
 * is due sequentially (never concurrently), report one heartbeat at the
 * end. Every "due" decision and the expensive-job budget check both use
 * the SAME status snapshot fetched at the top of this cycle — re-fetching
 * mid-cycle would add complexity for a coarse, explicitly-approximate gate
 * that doesn't need per-job precision (see shouldStartExpensiveJob's own
 * doc comment on the accepted v1 semantics).
 */
async function runOneCycle(config: AutomationConfig): Promise<void> {
  const status = await fetchStatus(config);
  const now = new Date();

  const tickDue = isJobDue(status.lastJobRunAt.tick, config.tickIntervalMinutes, now);
  const discoveryDue = isJobDue(status.lastJobRunAt.discovery, config.discoveryIntervalHours * 60, now);
  const analyzeDue = isJobDue(status.lastJobRunAt.analyze, config.analyzeIntervalHours * 60, now);

  const todayBirdeyeAttempts = status.todayProviderUsage.find((u) => u.provider === "birdeye")?.usage.outboundAttempts ?? 0;
  const expensiveJobsAllowed = shouldStartExpensiveJob(todayBirdeyeAttempts, config.expensiveJobDailyBudget);

  let ranSomething = false;
  const cycleErrors: string[] = [];

  // Ticks are never gated by the expensive-job budget — cheap, and the
  // entire reason this phase exists (Automatic Evidence Collection plan
  // §Provider-budget rework).
  if (tickDue) {
    ranSomething = true;
    try {
      await postJob(config, "/api/jobs/tick-active-strategies");
      log("tick-active-strategies completed");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      cycleErrors.push(`tick: ${message}`);
      log(`tick-active-strategies FAILED: ${message}`);
    }
  }

  if (discoveryDue) {
    if (expensiveJobsAllowed) {
      ranSomething = true;
      try {
        await postJob(config, "/api/jobs/discover-wallets");
        log("discover-wallets completed");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        cycleErrors.push(`discovery: ${message}`);
        log(`discover-wallets FAILED: ${message}`);
      }
    } else {
      log(
        `discovery is due but skipped — today's Birdeye usage (${todayBirdeyeAttempts}) is at/above the expensive-job budget (${config.expensiveJobDailyBudget}); will retry once discovery is due again`
      );
    }
  }

  if (analyzeDue) {
    if (expensiveJobsAllowed) {
      ranSomething = true;
      try {
        await postJob(config, "/api/jobs/analyze-candidates", { limit: config.analyzeBatchSize });
        log("analyze-candidates completed");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        cycleErrors.push(`analyze: ${message}`);
        log(`analyze-candidates FAILED: ${message}`);
      }
    } else {
      log(
        `candidate analysis is due but skipped — today's Birdeye usage (${todayBirdeyeAttempts}) is at/above the expensive-job budget (${config.expensiveJobDailyBudget}); will retry once analysis is due again`
      );
    }
  }

  await postHeartbeat(config, {
    runnerId,
    pid: process.pid,
    startedAt,
    cycleCompleted: ranSomething ? { status: cycleErrors.length === 0 ? "success" : "partial", error: cycleErrors.join("; ") || null } : undefined,
    config: heartbeatConfig(config),
  });
}

async function main(): Promise<void> {
  const config = loadAutomationConfig();
  log(`runner ${runnerId} started, pid ${process.pid}, target ${config.apiBaseUrl}`);
  log(
    `config: tick every ${config.tickIntervalMinutes}min, discovery every ${config.discoveryIntervalHours}h, analyze every ${config.analyzeIntervalHours}h (batch ${config.analyzeBatchSize}), expensive-job daily budget ${config.expensiveJobDailyBudget}`
  );

  while (!shutdownRequested) {
    try {
      await runOneCycle(config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`cycle failed before completing (e.g. Next.js unreachable): ${message} — will retry next poll, nothing marked as done`);
      await postHeartbeat(config, {
        runnerId,
        pid: process.pid,
        startedAt,
        cycleCompleted: { status: "failed", error: message },
        config: heartbeatConfig(config),
      }).catch(() => {
        // Best-effort — if even the heartbeat call fails (e.g. the app is
        // fully down), there's nothing more to do this iteration.
      });
    }

    if (shutdownRequested) break;
    await interruptibleSleep(config.pollIntervalSeconds * 1000);
  }

  log("shutting down: no new job will start, cleaning up");
  try {
    await postHeartbeat(config, {
      runnerId,
      pid: process.pid,
      startedAt,
      cycleCompleted: { status: "stopped" },
      config: heartbeatConfig(config),
    });
  } catch {
    // Best-effort final heartbeat — the local lock-file removal below is
    // what actually matters for allowing a future automation:start.
  }
  removeLockFile();
  log("stopped cleanly");
  process.exit(0);
}

main().catch((err) => {
  console.error(`[automation] fatal startup error: ${err instanceof Error ? err.message : String(err)}`);
  removeLockFile();
  process.exit(1);
});
