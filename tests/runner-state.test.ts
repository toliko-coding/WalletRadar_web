import { describe, expect, it } from "vitest";
import { deriveRunnerState, RUNNING_FRESHNESS_MINUTES } from "@/lib/automation/runner-state";

const now = new Date("2026-09-14T12:00:00Z");

describe("deriveRunnerState", () => {
  it("is 'never_started' when there is no heartbeat row at all", () => {
    expect(deriveRunnerState(null, now)).toBe("never_started");
  });

  it("is 'never_started' when the heartbeat row exists but lastHeartbeatAt is null", () => {
    expect(deriveRunnerState({ lastHeartbeatAt: null, lastCycleStatus: null }, now)).toBe("never_started");
  });

  it("is 'running' when the heartbeat is fresh, regardless of lastCycleStatus", () => {
    const fresh = new Date(now.getTime() - 30_000).toISOString(); // 30s old
    expect(deriveRunnerState({ lastHeartbeatAt: fresh, lastCycleStatus: "stopped" }, now)).toBe("running");
    expect(deriveRunnerState({ lastHeartbeatAt: fresh, lastCycleStatus: "success" }, now)).toBe("running");
  });

  it("is 'running' exactly at the freshness boundary", () => {
    const atBoundary = new Date(now.getTime() - RUNNING_FRESHNESS_MINUTES * 60_000).toISOString();
    expect(deriveRunnerState({ lastHeartbeatAt: atBoundary, lastCycleStatus: null }, now)).toBe("running");
  });

  it("is 'stopped' when the heartbeat is stale AND the last recorded status was an explicit clean shutdown", () => {
    const stale = new Date(now.getTime() - (RUNNING_FRESHNESS_MINUTES + 1) * 60_000).toISOString();
    expect(deriveRunnerState({ lastHeartbeatAt: stale, lastCycleStatus: "stopped" }, now)).toBe("stopped");
  });

  it("is 'unreachable' when the heartbeat is stale and the last status was anything other than 'stopped'", () => {
    const stale = new Date(now.getTime() - (RUNNING_FRESHNESS_MINUTES + 1) * 60_000).toISOString();
    expect(deriveRunnerState({ lastHeartbeatAt: stale, lastCycleStatus: "success" }, now)).toBe("unreachable");
    expect(deriveRunnerState({ lastHeartbeatAt: stale, lastCycleStatus: null }, now)).toBe("unreachable");
  });

  it("prioritizes freshness over a stale 'stopped' label — a fresh ping after restart is 'running' even before any job has completed", () => {
    // Regression case: a bare heartbeatLoop ping never touches lastCycleStatus,
    // so immediately after a restart the row can legitimately carry a fresh
    // last_heartbeat_at alongside a leftover 'stopped' status from the PRIOR
    // session. Freshness must win.
    const justPinged = new Date(now.getTime() - 5_000).toISOString();
    expect(deriveRunnerState({ lastHeartbeatAt: justPinged, lastCycleStatus: "stopped" }, now)).toBe("running");
  });
});
