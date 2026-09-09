import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export interface LockFileContents {
  pid: number;
  runnerId: string;
  startedAt: string;
}

// A substring expected in `ps`'s command output for a genuine runner
// process — guards against the OS reusing a PID for an unrelated process
// after a crash (see commandMatchesRunner below).
const RUNNER_SCRIPT_MARKER = "automation/runner.ts";

export function getLockFilePath(): string {
  return join(process.cwd(), "automation", ".runner.lock");
}

export function readLockFile(): LockFileContents | null {
  const path = getLockFilePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LockFileContents;
  } catch {
    return null;
  }
}

/** Contains only {pid, runnerId, startedAt} — never a credential. INTERNAL_JOB_SECRET is never written here. */
export function writeLockFile(contents: LockFileContents): void {
  writeFileSync(getLockFilePath(), JSON.stringify(contents, null, 2), "utf8");
}

export function removeLockFile(): void {
  try {
    unlinkSync(getLockFilePath());
  } catch {
    // Already gone — fine, this is what we wanted anyway.
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Confirms a live PID's actual command looks like this runner script —
 * the PID-reuse guard. If `ps` itself fails (e.g. no such process, or
 * running on a platform where this check can't be performed), treated as
 * "can't confirm," i.e. not a match — fail closed, never assume a live PID
 * is this runner without positive confirmation.
 */
export function commandMatchesRunner(pid: number): boolean {
  try {
    const output = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
    return output.includes(RUNNER_SCRIPT_MARKER);
  } catch {
    return false;
  }
}

/**
 * Local-authoritative duplicate-runner check — deliberately never consults
 * the DB heartbeat (see the approved plan's runner-lifecycle corrections):
 * a runner may legitimately be alive and correctly ticking while its
 * heartbeat goes stale (Next.js/Supabase briefly unreachable), which must
 * never be misread as "no runner is running." A runner is genuinely
 * already running only if all three hold: the lock file exists, its PID
 * is alive, and `ps` confirms that PID's command is this runner script.
 */
export function findLiveMatchingRunner(): LockFileContents | null {
  const lock = readLockFile();
  if (!lock) return null;
  if (!isPidAlive(lock.pid)) return null;
  if (!commandMatchesRunner(lock.pid)) return null;
  return lock;
}
