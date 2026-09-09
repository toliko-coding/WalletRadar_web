import { describe, expect, it, vi, beforeEach } from "vitest";

// tick-locks-data.ts (like every I/O module in this codebase) starts with
// `import "server-only"`, which throws unconditionally outside Next's own
// bundler (see node_modules/server-only/index.js) — stubbed here so this
// file, and only this file, can import it directly for a mocked-client unit
// test. Never hits a real database: the Supabase client itself is mocked.
vi.mock("server-only", () => ({}));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServiceClient: () => ({ rpc: rpcMock }),
}));

const { acquireStrategyTickLock, releaseStrategyTickLock, DEFAULT_TICK_LEASE_SECONDS } = await import(
  "@/lib/demo/tick-locks-data"
);

beforeEach(() => {
  rpcMock.mockReset();
});

describe("acquireStrategyTickLock", () => {
  it("calls acquire_strategy_tick_lock with the right params and the default lease", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const acquired = await acquireStrategyTickLock("strategy-1", "owner-1");
    expect(acquired).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("acquire_strategy_tick_lock", {
      p_strategy_id: "strategy-1",
      p_owner_id: "owner-1",
      p_lease_seconds: DEFAULT_TICK_LEASE_SECONDS,
    });
  });

  it("honors an explicit lease-seconds override", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    await acquireStrategyTickLock("strategy-1", "owner-1", 60);
    expect(rpcMock).toHaveBeenCalledWith("acquire_strategy_tick_lock", {
      p_strategy_id: "strategy-1",
      p_owner_id: "owner-1",
      p_lease_seconds: 60,
    });
  });

  it("maps a false RPC result to a normal 'not acquired' — not an error", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    await expect(acquireStrategyTickLock("strategy-1", "owner-1")).resolves.toBe(false);
  });

  it("throws on a genuine RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    await expect(acquireStrategyTickLock("strategy-1", "owner-1")).rejects.toThrow(/connection refused/);
  });
});

describe("releaseStrategyTickLock", () => {
  it("calls release_strategy_tick_lock with the right params", async () => {
    rpcMock.mockResolvedValue({ error: null });
    await releaseStrategyTickLock("strategy-1", "owner-1");
    expect(rpcMock).toHaveBeenCalledWith("release_strategy_tick_lock", {
      p_strategy_id: "strategy-1",
      p_owner_id: "owner-1",
    });
  });

  it("throws on a genuine RPC error", async () => {
    rpcMock.mockResolvedValue({ error: { message: "timeout" } });
    await expect(releaseStrategyTickLock("strategy-1", "owner-1")).rejects.toThrow(/timeout/);
  });
});
