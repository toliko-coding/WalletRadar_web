import { describe, expect, it } from "vitest";
import { classifyProviderError } from "@/lib/providers/error-classification";

class FakeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string
  ) {
    super(message);
  }
}

describe("classifyProviderError", () => {
  it("classifies HTTP 429 as rate_limited, using the error's own path", () => {
    const err = new FakeApiError("too many requests", 429, "/defi/price");
    expect(classifyProviderError(err, "/fallback")).toEqual({ reason: "rate_limited", path: "/defi/price" });
  });

  it("classifies a 5xx status as server_error", () => {
    const err = new FakeApiError("bad gateway", 502, "/wallet/v2/trade-data/single");
    expect(classifyProviderError(err, "/fallback")).toEqual({
      reason: "server_error",
      path: "/wallet/v2/trade-data/single",
    });
  });

  it("classifies a non-429 4xx status as client_error", () => {
    const err = new FakeApiError("not found", 404, "/defi/price");
    expect(classifyProviderError(err, "/fallback")).toEqual({ reason: "client_error", path: "/defi/price" });
  });

  it("classifies a raw network-level failure (TypeError, no status/path) as network_error using the context path", () => {
    const err = new TypeError("fetch failed");
    expect(classifyProviderError(err, "/defi/price")).toEqual({ reason: "network_error", path: "/defi/price" });
  });

  it("classifies a JSON parse failure (SyntaxError) as parse_error, NOT network_error", () => {
    const err = new SyntaxError("Unexpected token < in JSON at position 0");
    expect(classifyProviderError(err, "/defi/price")).toEqual({ reason: "parse_error", path: "/defi/price" });
  });

  it("classifies a genuinely unrecognized error shape as unknown, not defaulted to network_error", () => {
    const err = { weird: "shape" };
    expect(classifyProviderError(err, "/defi/price")).toEqual({ reason: "unknown", path: "/defi/price" });
  });

  it("classifies a plain string throw as unknown", () => {
    expect(classifyProviderError("just a string", "/defi/price")).toEqual({ reason: "unknown", path: "/defi/price" });
  });

  it("classifies a status-carrying error outside 4xx/5xx (the success:false-with-200 case) as unknown", () => {
    const err = new FakeApiError("success=false", 200, "/defi/price");
    expect(classifyProviderError(err, "/fallback")).toEqual({ reason: "unknown", path: "/defi/price" });
  });
});
