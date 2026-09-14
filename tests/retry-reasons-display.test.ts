import { describe, expect, it } from "vitest";
import { flattenRetryReasons } from "@/lib/telemetry/retry-reasons-display";

describe("flattenRetryReasons", () => {
  it("returns an empty array for empty retry_reasons", () => {
    expect(flattenRetryReasons({})).toEqual([]);
  });

  it("flattens a single reason/path pair", () => {
    expect(flattenRetryReasons({ rate_limited: { "/defi/price": 5 } })).toEqual([{ reason: "rate_limited", path: "/defi/price", count: 5 }]);
  });

  it("flattens multiple reasons and multiple endpoints, sorted by count descending", () => {
    const result = flattenRetryReasons({
      rate_limited: { "/defi/price": 2 },
      network_error: { "/defi/price": 31, "/wallet/v2/trade-data/single": 4 },
      server_error: { "/wallet/v2/trade-data/single": 3 },
    });
    expect(result).toEqual([
      { reason: "network_error", path: "/defi/price", count: 31 },
      { reason: "network_error", path: "/wallet/v2/trade-data/single", count: 4 },
      { reason: "server_error", path: "/wallet/v2/trade-data/single", count: 3 },
      { reason: "rate_limited", path: "/defi/price", count: 2 },
    ]);
  });

  it("breaks ties by reason then path, alphabetically, for a stable order", () => {
    const result = flattenRetryReasons({
      client_error: { "/b": 1 },
      rate_limited: { "/a": 1 },
    });
    expect(result).toEqual([
      { reason: "client_error", path: "/b", count: 1 },
      { reason: "rate_limited", path: "/a", count: 1 },
    ]);
  });
});
