import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";

// commandMatchesRunner shells out to `ps` — mocked so tests are
// deterministic (real `ps` output is host/platform-dependent), while
// everything else in these tests uses the real filesystem/real PIDs, per
// the plan's "real filesystem, temp dir — no network, no Supabase" rule.
const execFileSyncMock = vi.fn<(...args: unknown[]) => string>();
vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

const {
  getLockFilePath,
  readLockFile,
  writeLockFile,
  removeLockFile,
  isPidAlive,
  commandMatchesRunner,
  findLiveMatchingRunner,
} = await import("../automation/lock-file");

// Guaranteed-dead: PIDs this large are never actually assigned on macOS/Linux.
const DEAD_PID = 999_999_999;

afterEach(() => {
  removeLockFile();
  execFileSyncMock.mockReset();
});

describe("lock file read/write/remove", () => {
  it("reports no lock file present initially", () => {
    expect(existsSync(getLockFilePath())).toBe(false);
    expect(readLockFile()).toBeNull();
  });

  it("writes and reads back exactly {pid, runnerId, startedAt} — never a credential", () => {
    writeLockFile({ pid: 123, runnerId: "abc", startedAt: "2026-09-10T00:00:00Z" });
    const contents = readLockFile();
    expect(contents).toEqual({ pid: 123, runnerId: "abc", startedAt: "2026-09-10T00:00:00Z" });
    expect(Object.keys(contents!).sort()).toEqual(["pid", "runnerId", "startedAt"].sort());
  });

  it("removeLockFile is a safe no-op when nothing exists", () => {
    expect(() => removeLockFile()).not.toThrow();
    removeLockFile();
    expect(existsSync(getLockFilePath())).toBe(false);
  });
});

describe("isPidAlive", () => {
  it("is true for the current process", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it("is false for an implausibly large PID", () => {
    expect(isPidAlive(DEAD_PID)).toBe(false);
  });
});

describe("commandMatchesRunner", () => {
  it("is true when ps reports the runner script in the command", () => {
    execFileSyncMock.mockReturnValue("/usr/bin/tsx automation/runner.ts\n");
    expect(commandMatchesRunner(process.pid)).toBe(true);
  });

  it("is false when ps reports an unrelated command (possible PID reuse)", () => {
    execFileSyncMock.mockReturnValue("/usr/bin/node some-other-script.js\n");
    expect(commandMatchesRunner(process.pid)).toBe(false);
  });

  it("fails closed (false) when ps itself fails", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("no such process");
    });
    expect(commandMatchesRunner(DEAD_PID)).toBe(false);
  });
});

describe("findLiveMatchingRunner — the local-only authoritative duplicate check", () => {
  it("returns null when there is no lock file", () => {
    expect(findLiveMatchingRunner()).toBeNull();
  });

  it("returns null for a dead-PID lock file (start should proceed, overwriting it)", () => {
    writeLockFile({ pid: DEAD_PID, runnerId: "stale", startedAt: "2026-09-10T00:00:00Z" });
    expect(findLiveMatchingRunner()).toBeNull();
  });

  it("returns null for a live PID whose command doesn't match (foreign/reused PID — start proceeds)", () => {
    writeLockFile({ pid: process.pid, runnerId: "foreign", startedAt: "2026-09-10T00:00:00Z" });
    execFileSyncMock.mockReturnValue("/usr/bin/some-unrelated-process\n");
    expect(findLiveMatchingRunner()).toBeNull();
  });

  it("returns the lock contents for a live PID whose command matches (genuinely already running — start refuses)", () => {
    writeLockFile({ pid: process.pid, runnerId: "real", startedAt: "2026-09-10T00:00:00Z" });
    execFileSyncMock.mockReturnValue("/usr/bin/tsx automation/runner.ts\n");
    expect(findLiveMatchingRunner()).toEqual({ pid: process.pid, runnerId: "real", startedAt: "2026-09-10T00:00:00Z" });
  });
});
