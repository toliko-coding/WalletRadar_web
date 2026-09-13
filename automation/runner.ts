/**
 * The automation poll-loop — runs as a detached child process spawned by
 * cli.ts, entirely outside the Next.js app's own lifecycle (import
 * "server-only" genuinely throws when this project's business-logic
 * modules are imported outside Next's bundler — verified this session —
 * so this process only ever talks to the app over HTTP, reusing the
 * existing job/automation routes rather than duplicating any trading or
 * validation logic itself).
 *
 * Corrective Phase v2 architecture: THREE independent loops, not one
 * blocking cycle —
 *   - tickLoop: strategy ticks, time-sensitive, never blocked by anything
 *     else in this process.
 *   - heartbeatLoop: a bare liveness ping on its own short interval,
 *     decoupled from whatever the other two loops are doing, so
 *     last_heartbeat_at stays fresh even during a long maintenance job.
 *   - maintenanceLoop: discovery/exploration/refresh, serialized — at most
 *     one of these three runs at a time, chosen by priority
 *     (REFRESH > EXPLORATION > DISCOVERY) among whichever are both due and
 *     budget/backlog-eligible this iteration.
 * The actual due-check-and-maybe-run decision for each loop lives in
 * automation/loops.ts (runOneTickCheck / runOneHeartbeatPing /
 * runOneMaintenanceCheck) — kept separate specifically so it's unit-
 * testable with injected fetchStatus/postJob, including simulating a slow
 * maintenance job without ever running a real multi-hour one.
 *
 * Never fabricates progress: every "is X due" decision is re-derived fresh
 * from the server's own persisted state (job_runs, via
 * /api/automation/status) at the start of every check — this process keeps
 * no authoritative memory of its own about what it did last, so a crash,
 * a Mac sleep, or the Next.js server being briefly unreachable can never
 * cause a burst of catch-up runs or a false "already done" skip.
 */
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadAutomationConfig, type AutomationConfig } from "./config";
import { postHeartbeat } from "./api-client";
import { removeLockFile } from "./lock-file";
import { runOneTickCheck, runOneHeartbeatPing, runOneMaintenanceCheck, type RunnerIdentity } from "./loops";

// .env.local is outside Next.js's own env-loading pipeline for this
// standalone process — must be loaded explicitly. Native to Node 20.6+/22
// (this project already targets Node 22 — see README), no extra
// dependency needed.
process.loadEnvFile(resolve(process.cwd(), ".env.local"));

const identity: RunnerIdentity = {
  runnerId: process.env.WALLETRADAR_RUNNER_ID ?? randomUUID(),
  pid: process.pid,
  startedAt: process.env.WALLETRADAR_RUNNER_STARTED_AT ?? new Date().toISOString(),
};

let shutdownRequested = false;

function log(message: string): void {
  console.log(`[automation ${new Date().toISOString()}] ${message}`);
}

/**
 * Each loop gets its OWN interruptible-sleep resolver slot — with three
 * independent loops now instead of one, a single shared resolver (the
 * original design) would only ever wake whichever loop happened to set it
 * last. `requestShutdown` wakes all three explicitly.
 */
function makeInterruptibleSleep(): { sleep: (ms: number) => Promise<void>; wake: () => void } {
  let currentResolve: (() => void) | null = null;
  return {
    sleep(ms: number): Promise<void> {
      return new Promise((res) => {
        currentResolve = res;
        setTimeout(() => {
          currentResolve = null;
          res();
        }, ms);
      });
    },
    wake(): void {
      currentResolve?.();
      currentResolve = null;
    },
  };
}

const tickSleeper = makeInterruptibleSleep();
const heartbeatSleeper = makeInterruptibleSleep();
const maintenanceSleeper = makeInterruptibleSleep();

function requestShutdown(signal: string): void {
  log(`received ${signal}, finishing any in-flight work on each loop and shutting down gracefully — never force-killing`);
  shutdownRequested = true;
  tickSleeper.wake();
  heartbeatSleeper.wake();
  maintenanceSleeper.wake();
}

process.on("SIGTERM", () => requestShutdown("SIGTERM"));
process.on("SIGINT", () => requestShutdown("SIGINT"));

/**
 * Generic "check once, sleep, repeat until shutdown" wrapper shared by all
 * three loops — a failure inside `check` (e.g. Next.js unreachable) is
 * caught here so it can never crash this loop or any other; the loop
 * simply retries on its next poll, matching the original single-cycle
 * design's "attempted call, not a successful run" semantics.
 */
async function runLoop(
  loopName: string,
  config: AutomationConfig,
  sleeper: { sleep: (ms: number) => Promise<void>; wake: () => void },
  check: () => Promise<void>
): Promise<void> {
  while (!shutdownRequested) {
    try {
      await check();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`${loopName} check failed before completing (e.g. Next.js unreachable): ${message} — will retry next poll, nothing marked as done`);
    }
    if (shutdownRequested) break;
    await sleeper.sleep(config.pollIntervalSeconds * 1000);
  }
  log(`${loopName} loop stopped`);
}

async function main(): Promise<void> {
  const config = loadAutomationConfig();
  log(`runner ${identity.runnerId} started, pid ${identity.pid}, target ${config.apiBaseUrl}`);
  log(
    `config: tick every ${config.tickIntervalMinutes}min; maintenance priority refresh(${config.analyzeRefreshIntervalHours}h)>exploration(${config.analyzeIntervalHours}h)>discovery(${config.discoveryIntervalHours}h); ` +
      `discovery backlog high-water mark ${config.discoveryBacklogHighWaterMark}; budget: refresh-only above ${config.budgetRefreshReserveThreshold}, nothing above ${config.expensiveJobDailyBudget}`
  );

  await Promise.all([
    runLoop("tick", config, tickSleeper, () => runOneTickCheck(config, identity)),
    runLoop("heartbeat", config, heartbeatSleeper, () => runOneHeartbeatPing(config, identity)),
    runLoop("maintenance", config, maintenanceSleeper, () => runOneMaintenanceCheck(config, identity)),
  ]);

  log("all loops stopped: no new job will start, cleaning up");
  try {
    await postHeartbeat(config, {
      ...identity,
      cycleCompleted: { status: "stopped" },
      config: {
        tickIntervalMinutes: config.tickIntervalMinutes,
        discoveryIntervalHours: config.discoveryIntervalHours,
        analyzeIntervalHours: config.analyzeIntervalHours,
        analyzeBatchSize: config.analyzeBatchSize,
        expensiveJobDailyBudget: config.expensiveJobDailyBudget,
      },
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
