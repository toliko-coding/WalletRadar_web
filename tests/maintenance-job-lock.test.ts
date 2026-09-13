import { describe, expect, it, vi, beforeEach } from "vitest";

// See tests/strategy-tick-lock.test.ts's identical note: "server-only"
// throws unconditionally outside Next's own bundler, so it's stubbed here
// to unit-test this I/O module directly with a mocked Supabase client.
vi.mock("server-only", () => ({}));

const rpcMock = vi.fn();
const fromMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServiceClient: () => ({ rpc: rpcMock, from: fromMock }),
}));

const { acquireMaintenanceJobLock, releaseMaintenanceJobLock, getMaintenanceLockStatus, withMaintenanceLock, DEFAULT_MAINTENANCE_LEASE_SECONDS } =
  await import("@/lib/jobs/maintenance-lock");

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
});

describe("acquireMaintenanceJobLock", () => {
  it("calls acquire_maintenance_job_lock with the right params and the default 12h lease", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const acquired = await acquireMaintenanceJobLock("owner-1", "discover-wallets");
    expect(acquired).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("acquire_maintenance_job_lock", {
      p_owner_id: "owner-1",
      p_job_name: "discover-wallets",
      p_lease_seconds: DEFAULT_MAINTENANCE_LEASE_SECONDS,
    });
    expect(DEFAULT_MAINTENANCE_LEASE_SECONDS).toBe(43200);
  });

  it("maps a false RPC result to a normal 'not acquired' — not an error", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    await expect(acquireMaintenanceJobLock("owner-1", "analyze-candidate-wallets")).resolves.toBe(false);
  });

  it("throws on a genuine RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    await expect(acquireMaintenanceJobLock("owner-1", "discover-wallets")).rejects.toThrow(/connection refused/);
  });
});

describe("releaseMaintenanceJobLock", () => {
  it("calls release_maintenance_job_lock with just the owner id (global, not per-job)", async () => {
    rpcMock.mockResolvedValue({ error: null });
    await releaseMaintenanceJobLock("owner-1");
    expect(rpcMock).toHaveBeenCalledWith("release_maintenance_job_lock", { p_owner_id: "owner-1" });
  });

  it("throws on a genuine RPC error", async () => {
    rpcMock.mockResolvedValue({ error: { message: "timeout" } });
    await expect(releaseMaintenanceJobLock("owner-1")).rejects.toThrow(/timeout/);
  });
});

function mockSelectChain(data: unknown) {
  const maybeSingle = vi.fn().mockResolvedValue({ data });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  fromMock.mockReturnValue({ select });
}

describe("getMaintenanceLockStatus", () => {
  it("reports not held when no row exists", async () => {
    mockSelectChain(null);
    await expect(getMaintenanceLockStatus()).resolves.toEqual({
      held: false,
      currentJobName: null,
      lockedAt: null,
      lockedUntil: null,
    });
  });

  it("reports held with current_job_name/locked_at/locked_until when the lease is unexpired", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    mockSelectChain({ current_job_name: "analyze-candidate-wallets", locked_at: "2026-01-01T00:00:00Z", locked_until: future });
    const status = await getMaintenanceLockStatus();
    expect(status.held).toBe(true);
    expect(status.currentJobName).toBe("analyze-candidate-wallets");
    expect(status.lockedUntil).toBe(future);
  });

  it("reports NOT held when a row exists but its lease has already expired", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    mockSelectChain({ current_job_name: "discover-wallets", locked_at: "2026-01-01T00:00:00Z", locked_until: past });
    const status = await getMaintenanceLockStatus();
    expect(status.held).toBe(false);
    // Still surfaces who last held it / when it expired, for observability.
    expect(status.currentJobName).toBe("discover-wallets");
  });

  it("never returns an owner_id field, only the four approved fields", async () => {
    mockSelectChain({ current_job_name: "discover-wallets", locked_at: "x", locked_until: "y" });
    const status = await getMaintenanceLockStatus();
    expect(Object.keys(status).sort()).toEqual(["currentJobName", "held", "lockedAt", "lockedUntil"].sort());
  });
});

describe("withMaintenanceLock", () => {
  it("runs fn and returns its result when the lock is acquired, then releases it", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "acquire_maintenance_job_lock") return Promise.resolve({ data: true, error: null });
      if (name === "release_maintenance_job_lock") return Promise.resolve({ error: null });
      throw new Error(`unexpected rpc ${name}`);
    });
    const fn = vi.fn().mockResolvedValue({ processed: 3 });

    const result = await withMaintenanceLock("discover-wallets", fn);

    expect(result).toEqual({ processed: 3 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("release_maintenance_job_lock", expect.any(Object));
  });

  it("never calls fn when the lock is already held — returns lockSkipped instead", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null }); // acquire fails
    const fn = vi.fn();

    const result = await withMaintenanceLock("analyze-candidate-wallets", fn);

    expect(result).toEqual({ lockSkipped: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it("never calls fn when the acquire check itself throws (fails closed, treated like 'already held')", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    const fn = vi.fn();

    const result = await withMaintenanceLock("analyze-refresh-wallets", fn);

    expect(result).toEqual({ lockSkipped: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it("releases the lock even when fn throws, and lets the error propagate", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "acquire_maintenance_job_lock") return Promise.resolve({ data: true, error: null });
      if (name === "release_maintenance_job_lock") return Promise.resolve({ error: null });
      throw new Error(`unexpected rpc ${name}`);
    });
    const fn = vi.fn().mockRejectedValue(new Error("job blew up"));

    await expect(withMaintenanceLock("discover-wallets", fn)).rejects.toThrow("job blew up");
    expect(rpcMock).toHaveBeenCalledWith("release_maintenance_job_lock", expect.any(Object));
  });

  it("a release failure never masks fn's already-computed result", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "acquire_maintenance_job_lock") return Promise.resolve({ data: true, error: null });
      if (name === "release_maintenance_job_lock") return Promise.resolve({ error: { message: "release failed" } });
      throw new Error(`unexpected rpc ${name}`);
    });
    const fn = vi.fn().mockResolvedValue({ processed: 5 });

    await expect(withMaintenanceLock("discover-wallets", fn)).resolves.toEqual({ processed: 5 });
  });
});
