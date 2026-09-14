import { describe, expect, it } from "vitest";
import { deriveRunnerState, RUNNING_FRESHNESS_MINUTES } from "@/lib/automation/runner-state";

const now = new Date("2026-09-14T12:00:00Z");

describe("deriveRunnerState", () => {
  it("is 'never_started' when there is no heartbeat row at all", () => {
    expect(deriveRunnerState(null, now)).toBe("never_started");
  });

  it("is 'never_started' when the heartbeat row exists but lastHeartbeatAt is null", () => {
    expect(deriveRunnerState({ lastHeartbeatAt: null, lastCycleStatus: null, lastCycleCompletedAt: null }, now)).toBe("never_started");
  });

  it("is 'running' when the heartbeat is fresh and the last status wasn't 'stopped'", () => {
    const fresh = new Date(now.getTime() - 30_000).toISOString(); // 30s old
    expect(deriveRunnerState({ lastHeartbeatAt: fresh, lastCycleStatus: "success", lastCycleCompletedAt: fresh }, now)).toBe("running");
    expect(deriveRunnerState({ lastHeartbeatAt: fresh, lastCycleStatus: null, lastCycleCompletedAt: null }, now)).toBe("running");
  });

  it("is 'running' exactly at the freshness boundary", () => {
    const atBoundary = new Date(now.getTime() - RUNNING_FRESHNESS_MINUTES * 60_000).toISOString();
    expect(deriveRunnerState({ lastHeartbeatAt: atBoundary, lastCycleStatus: null, lastCycleCompletedAt: null }, now)).toBe("running");
  });

  it("is 'stopped' IMMEDIATELY after a clean shutdown, even though the heartbeat is still fresh (regression: a just-stopped runner must not read as 'running')", () => {
    // recordHeartbeat's final "stopped" write stamps lastHeartbeatAt and
    // lastCycleCompletedAt from the SAME `now` — this is what a genuinely
    // current stop report looks like.
    const justStopped = new Date(now.getTime() - 5_000).toISOString(); // 5s ago — well within the freshness window
    expect(
      deriveRunnerState({ lastHeartbeatAt: justStopped, lastCycleStatus: "stopped", lastCycleCompletedAt: justStopped }, now)
    ).toBe("stopped");
  });

  it("is 'stopped' long after a clean shutdown too, with no further pings", () => {
    const longAgo = new Date(now.getTime() - (RUNNING_FRESHNESS_MINUTES + 30) * 60_000).toISOString();
    expect(deriveRunnerState({ lastHeartbeatAt: longAgo, lastCycleStatus: "stopped", lastCycleCompletedAt: longAgo }, now)).toBe("stopped");
  });

  it("is 'unreachable' when the heartbeat is stale and the last status was anything other than a CURRENT 'stopped' report", () => {
    const stale = new Date(now.getTime() - (RUNNING_FRESHNESS_MINUTES + 1) * 60_000).toISOString();
    expect(deriveRunnerState({ lastHeartbeatAt: stale, lastCycleStatus: "success", lastCycleCompletedAt: stale }, now)).toBe("unreachable");
    expect(deriveRunnerState({ lastHeartbeatAt: stale, lastCycleStatus: null, lastCycleCompletedAt: null }, now)).toBe("unreachable");
  });

  it("prioritizes a fresh ping over a STALE 'stopped' label — restarted after a prior stop, pinged since, no job completed yet -> 'running'", () => {
    // Regression case (the original bug this function's design fixed): a
    // bare heartbeatLoop ping never touches lastCycleStatus/
    // lastCycleCompletedAt, only lastHeartbeatAt — so after a restart, the
    // row legitimately shows a fresh heartbeat NEWER than the leftover
    // 'stopped' completedAt from the PRIOR session. That must read as
    // "running", not "stopped".
    const priorStopTime = new Date(now.getTime() - 10 * 60_000).toISOString(); // 10 min ago
    const justPinged = new Date(now.getTime() - 5_000).toISOString(); // 5s ago — newer than the stop
    expect(
      deriveRunnerState({ lastHeartbeatAt: justPinged, lastCycleStatus: "stopped", lastCycleCompletedAt: priorStopTime }, now)
    ).toBe("running");
  });

  it("treats a 'stopped' status with no lastCycleCompletedAt as not-a-current-report (defensive — falls through to freshness)", () => {
    const fresh = new Date(now.getTime() - 5_000).toISOString();
    expect(deriveRunnerState({ lastHeartbeatAt: fresh, lastCycleStatus: "stopped", lastCycleCompletedAt: null }, now)).toBe("running");
  });
});
