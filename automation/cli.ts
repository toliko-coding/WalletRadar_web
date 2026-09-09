/**
 * automation:start | automation:stop | automation:status
 *
 * `start`: validates config (fails fast, before touching anything, if
 * INTERNAL_JOB_SECRET is missing or the API base URL isn't loopback — see
 * config.ts), refuses if a live, matching local runner already exists
 * (lock file + live PID + `ps` command match — never the DB heartbeat, see
 * lock-file.ts), then spawns automation/runner.ts as a DETACHED child
 * process and exits immediately. The child keeps running independently of
 * this terminal session — closing the terminal does not stop it.
 *
 * `stop`: sends SIGTERM and waits for the process to exit on its own — no
 * fixed timeout, no escalation to SIGKILL. A normal stop never force-kills
 * legitimate in-flight work (e.g. a long-running candidate-analysis
 * batch); a genuinely hung process is a separate, explicit, manual
 * operational action, not something this command does automatically.
 *
 * `status`: reports the local lock-file state (authoritative for "is a
 * runner running") plus, best-effort, the DB-recorded heartbeat/active-
 * strategy count if the app happens to be reachable (purely informational).
 */
import { resolve, join } from "node:path";
import { openSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { loadAutomationConfig } from "./config";
import { fetchStatus } from "./api-client";
import {
  findLiveMatchingRunner,
  readLockFile,
  writeLockFile,
  removeLockFile,
  isPidAlive,
  commandMatchesRunner,
  getLockFilePath,
} from "./lock-file";

// .env.local is outside Next.js's own env-loading pipeline — must be
// loaded explicitly before loadAutomationConfig() can validate anything.
process.loadEnvFile(resolve(process.cwd(), ".env.local"));

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function cmdStart(): void {
  let config;
  try {
    config = loadAutomationConfig();
  } catch (err) {
    console.error(`[automation] cannot start: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const existing = findLiveMatchingRunner();
  if (existing) {
    console.error(
      `[automation] already running: pid ${existing.pid}, runnerId ${existing.runnerId}, started ${existing.startedAt}. Run "npm run automation:stop" first if you want to restart it.`
    );
    process.exitCode = 1;
    return;
  }

  const runnerId = randomUUID();
  const startedAt = new Date().toISOString();
  const runnerScript = resolve(process.cwd(), "automation", "runner.ts");
  const tsxBin = join(process.cwd(), "node_modules", ".bin", "tsx");
  const logPath = join(process.cwd(), "automation", "runner.log");
  const logFd = openSync(logPath, "a");

  const child = spawn(tsxBin, [runnerScript], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      WALLETRADAR_RUNNER_ID: runnerId,
      WALLETRADAR_RUNNER_STARTED_AT: startedAt,
    },
    cwd: process.cwd(),
  });

  if (!child.pid) {
    console.error("[automation] failed to spawn the runner process");
    process.exitCode = 1;
    return;
  }

  child.unref();
  writeLockFile({ pid: child.pid, runnerId, startedAt });

  console.log(`[automation] started: pid ${child.pid}, runnerId ${runnerId}`);
  console.log(`[automation] config: tick every ${config.tickIntervalMinutes}min, discovery every ${config.discoveryIntervalHours}h, analyze every ${config.analyzeIntervalHours}h (batch ${config.analyzeBatchSize}), expensive-job budget ${config.expensiveJobDailyBudget}/day`);
  console.log(`[automation] logs: ${logPath}`);
}

async function cmdStop(): Promise<void> {
  const lock = readLockFile();
  if (!lock) {
    console.log("[automation] not running (no lock file)");
    return;
  }
  if (!isPidAlive(lock.pid)) {
    console.log(`[automation] stale lock file (pid ${lock.pid} is not running) — removing it`);
    removeLockFile();
    return;
  }
  if (!commandMatchesRunner(lock.pid)) {
    console.error(
      `[automation] pid ${lock.pid} is alive but its command doesn't look like the automation runner (possible PID reuse) — refusing to signal an unrelated process. Investigate ${getLockFilePath()} manually if this persists.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[automation] sending SIGTERM to pid ${lock.pid} — graceful stop: waits for any in-flight job/cycle to finish naturally, no forced kill. This can take a while if a candidate-analysis batch is currently running.`
  );
  process.kill(lock.pid, "SIGTERM");

  while (isPidAlive(lock.pid)) {
    await sleep(1000);
  }
  console.log("[automation] stopped");
}

async function cmdStatus(): Promise<void> {
  const lock = findLiveMatchingRunner();
  if (lock) {
    console.log(`[automation] running locally: pid ${lock.pid}, runnerId ${lock.runnerId}, started ${lock.startedAt}`);
  } else {
    const rawLock = readLockFile();
    console.log(
      rawLock
        ? `[automation] not running (lock file present but pid ${rawLock.pid} is dead or doesn't match — stale, will self-heal on next start)`
        : "[automation] not running (no lock file)"
    );
  }

  // Best-effort DB-recorded health, purely informational — never the
  // authority for the local running/not-running determination above.
  try {
    const config = loadAutomationConfig();
    const status = await fetchStatus(config);
    console.log(
      status.heartbeat
        ? `[automation] last DB heartbeat: ${status.heartbeat.lastHeartbeatAt} (last cycle: ${status.heartbeat.lastCycleStatus ?? "n/a"})`
        : "[automation] no DB heartbeat recorded yet"
    );
    console.log(`[automation] active strategies: ${status.activeStrategies.length}`);
  } catch (err) {
    console.log(`[automation] could not reach the app for extended status: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "start") return cmdStart();
  if (command === "stop") return cmdStop();
  if (command === "status") return cmdStatus();
  console.error("Usage: npm run automation:start | automation:stop | automation:status");
  process.exitCode = 1;
}

main();
