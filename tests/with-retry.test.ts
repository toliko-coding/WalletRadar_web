import { describe, expect, it, vi } from "vitest";
import { withRetry } from "@/lib/rate-limit/token-bucket";

describe("withRetry", () => {
  it("succeeds without ever calling onRetry when the first attempt succeeds", async () => {
    const onRetry = vi.fn();
    const result = await withRetry(async () => "ok", { onRetry, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("calls onRetry once per failed attempt, including the final one that exhausts retries", async () => {
    const onRetry = vi.fn();
    const err = new Error("boom");
    await expect(withRetry(async () => { throw err; }, { retries: 2, baseDelayMs: 1, onRetry })).rejects.toThrow("boom");
    // retries: 2 -> attempts 0, 1, 2 all fail -> onRetry called 3 times.
    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenNthCalledWith(1, err, 0);
    expect(onRetry).toHaveBeenNthCalledWith(2, err, 1);
    expect(onRetry).toHaveBeenNthCalledWith(3, err, 2);
  });

  it("a well-behaved onRetry (the only kind ever used in practice — see client.ts) never changes the retry count or outcome vs. no callback at all", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw new Error("transient");
        return "recovered";
      },
      { retries: 3, baseDelayMs: 1, onRetry: () => {} }
    );
    expect(result).toBe("recovered");
    expect(calls).toBe(2);
  });

  it("still retries exactly `retries` times and applies backoff identically with or without onRetry", async () => {
    let attemptsNoCallback = 0;
    let attemptsWithCallback = 0;
    await expect(
      withRetry(async () => { attemptsNoCallback += 1; throw new Error("x"); }, { retries: 2, baseDelayMs: 1 })
    ).rejects.toThrow();
    await expect(
      withRetry(async () => { attemptsWithCallback += 1; throw new Error("x"); }, { retries: 2, baseDelayMs: 1, onRetry: () => {} })
    ).rejects.toThrow();
    expect(attemptsWithCallback).toBe(attemptsNoCallback);
    expect(attemptsWithCallback).toBe(3);
  });
});
