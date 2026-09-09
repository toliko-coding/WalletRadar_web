import { describe, expect, it } from "vitest";
import { isJobDue, computeNextDueAt, shouldStartExpensiveJob, isLoopbackHost } from "@/lib/automation/scheduling";

describe("isJobDue", () => {
  it("is due immediately when it has never run before", () => {
    expect(isJobDue(null, 15, new Date("2026-09-10T00:00:00Z"))).toBe(true);
  });

  it("is not due before the interval has elapsed", () => {
    const lastRunAt = "2026-09-10T00:00:00Z";
    const now = new Date("2026-09-10T00:10:00Z"); // 10 min later, interval is 15
    expect(isJobDue(lastRunAt, 15, now)).toBe(false);
  });

  it("is due exactly at the interval boundary", () => {
    const lastRunAt = "2026-09-10T00:00:00Z";
    const now = new Date("2026-09-10T00:15:00Z");
    expect(isJobDue(lastRunAt, 15, now)).toBe(true);
  });

  it("is due after a long gap (e.g. Mac sleep) — but this only ever answers 'due or not', never how many cycles were missed", () => {
    const lastRunAt = "2026-09-08T00:00:00Z";
    const now = new Date("2026-09-10T00:00:00Z"); // 2 days later
    expect(isJobDue(lastRunAt, 15, now)).toBe(true);
  });
});

describe("computeNextDueAt", () => {
  it("returns null when there's no last run (already due, nothing to compute)", () => {
    expect(computeNextDueAt(null, 15)).toBeNull();
  });

  it("adds the interval in minutes to the last run time", () => {
    expect(computeNextDueAt("2026-09-10T00:00:00.000Z", 15)).toBe("2026-09-10T00:15:00.000Z");
  });
});

describe("shouldStartExpensiveJob — pre-job start gate, not a hard running cap", () => {
  it("allows starting when today's usage is below the budget", () => {
    expect(shouldStartExpensiveJob(480, 500)).toBe(true);
  });

  it("blocks starting once usage is at or above the budget", () => {
    expect(shouldStartExpensiveJob(500, 500)).toBe(false);
    expect(shouldStartExpensiveJob(520, 500)).toBe(false);
  });

  it("this is a start-time check only — a job already authorized to start (e.g. at 480) can still push the total past budget once it completes; that's not something this function itself models, by design", () => {
    // Documents the accepted v1 semantics directly: shouldStartExpensiveJob
    // is asked once, before a job starts, using whatever the usage number
    // was at that moment — it has no knowledge of, or control over, what a
    // job does once it's running.
    const authorizedAtStart = shouldStartExpensiveJob(480, 500);
    expect(authorizedAtStart).toBe(true);
  });
});

describe("isLoopbackHost", () => {
  it.each(["127.0.0.1", "localhost", "::1", "[::1]", "LOCALHOST", "127.0.0.1".toUpperCase()])(
    "accepts %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    }
  );

  it.each(["example.com", "0.0.0.0", "10.0.0.5", "192.168.1.1", "my-remote-server.internal", ""])(
    "rejects %s",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    }
  );
});
