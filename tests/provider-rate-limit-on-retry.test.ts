import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// See tests/strategy-tick-lock.test.ts's identical note re: "server-only".
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  requireBirdeyeApiKey: () => "test-birdeye-key",
  requireHeliusApiKey: () => "test-helius-key",
}));
vi.mock("@/lib/telemetry/provider-usage-data", () => ({ recordProviderUsage: vi.fn().mockResolvedValue(undefined) }));

// Pre-seed the globalThis slots getGlobalTokenBucket reads from, with a
// spy in place of a real TokenBucket — proves WHERE/HOW OFTEN bucket.take()
// is called without needing real refill timing.
const birdeyeTakeMock = vi.fn().mockResolvedValue(undefined);
const heliusTakeMock = vi.fn().mockResolvedValue(undefined);
(globalThis as unknown as Record<string, unknown>).__walletradar_token_bucket__birdeye = { take: birdeyeTakeMock };
(globalThis as unknown as Record<string, unknown>).__walletradar_token_bucket__helius = { take: heliusTakeMock };

const { birdeyeRequest } = await import("@/lib/providers/birdeye/client");
const { heliusGet } = await import("@/lib/providers/helius/client");

beforeEach(() => {
  birdeyeTakeMock.mockClear();
  heliusTakeMock.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Drains withRetry's real setTimeout-based backoff without waiting for it in real time. */
async function runWithFakeBackoff<T>(promise: Promise<T>): Promise<T> {
  const resultPromise = promise.then(
    (v) => ({ ok: true as const, v }),
    (e) => ({ ok: false as const, e })
  );
  // A handful of advances comfortably covers withRetry's default 3 retries
  // (300/600/1200ms + jitter) regardless of exact timer ordering.
  for (let i = 0; i < 10; i++) {
    await vi.advanceTimersByTimeAsync(5000);
  }
  const result = await resultPromise;
  if (!result.ok) throw result.e;
  return result.v;
}

describe("Birdeye: every physical attempt acquires a token, including retries", () => {
  it("calls bucket.take() once per physical fetch — 1 for a first-try success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: "ok" }) })
    );

    await runWithFakeBackoff(birdeyeRequest("/defi/price"));

    expect(birdeyeTakeMock).toHaveBeenCalledTimes(1);
  });

  it("calls bucket.take() once per physical attempt when retries happen — 3 attempts -> 3 take() calls, not 1", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err1" })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err2" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: "ok" }) });
    vi.stubGlobal("fetch", fetchMock);

    await runWithFakeBackoff(birdeyeRequest("/defi/price"));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The core Corrective Phase v2 fix: previously take() was called ONCE
    // before withRetry, regardless of how many physical attempts followed.
    expect(birdeyeTakeMock).toHaveBeenCalledTimes(3);
  });

  it("still calls take() for every attempt even when every attempt ultimately fails (exhausted retries)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "down" }));

    await expect(runWithFakeBackoff(birdeyeRequest("/defi/price"))).rejects.toThrow();

    // Default retries=3 -> 4 total physical attempts.
    expect(birdeyeTakeMock).toHaveBeenCalledTimes(4);
  });
});

describe("Helius: the equivalent fix applies identically", () => {
  it("calls bucket.take() once per physical attempt when retries happen", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err1" })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: "ok" }) });
    vi.stubGlobal("fetch", fetchMock);

    await runWithFakeBackoff(heliusGet("/v0/some-path"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(heliusTakeMock).toHaveBeenCalledTimes(2);
  });
});
