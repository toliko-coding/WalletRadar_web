/**
 * Pure classification of a provider-call failure into one of six reasons —
 * no I/O, unit-testable without a real request. This exists ONLY to explain
 * the ~45-50% Birdeye retry rate found in the Automatic Evidence Collection
 * audit; it does not change retry behavior, backoff, or retryability
 * anywhere (see token-bucket.ts's `onRetry` — a pure observer callback).
 *
 * Deliberately does NOT default to "network_error" for anything without an
 * HTTP status — that would conflate three genuinely different failure
 * modes: a request that never got a response at all (a real network
 * failure), a response that was received but wasn't valid JSON (a parse
 * failure — a very different signal, e.g. an HTML error page or a truncated
 * body), and something that matches neither known shape (unknown, a real
 * catch-all, not a guess).
 */
export type ProviderErrorReason =
  | "rate_limited"
  | "server_error"
  | "client_error"
  | "network_error"
  | "parse_error"
  | "unknown";

export interface ClassifiedProviderError {
  reason: ProviderErrorReason;
  /** The Birdeye/Helius request path this failure occurred on. */
  path: string;
}

interface StatusCarryingError {
  status: number;
  path: string;
}

function hasStatusAndPath(error: unknown): error is StatusCarryingError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { status?: unknown }).status === "number" &&
    typeof (error as { path?: unknown }).path === "string"
  );
}

/**
 * `contextPath` is used whenever the error itself doesn't carry a `.path`
 * (i.e. it wasn't a `BirdeyeApiError`/`HeliusApiError` — the request never
 * got far enough to construct one) — the caller always knows which path it
 * was requesting, so this is threaded through rather than guessed at.
 */
export function classifyProviderError(error: unknown, contextPath: string): ClassifiedProviderError {
  if (hasStatusAndPath(error)) {
    if (error.status === 429) return { reason: "rate_limited", path: error.path };
    if (error.status >= 500) return { reason: "server_error", path: error.path };
    if (error.status >= 400) return { reason: "client_error", path: error.path };
    // A BirdeyeApiError/HeliusApiError with a non-error-range status only
    // happens on the `success: false` body case (client.ts constructs it
    // with `res.status`, which was 200 there) — genuinely doesn't fit
    // rate_limited/server_error/client_error, so falls through to unknown.
    return { reason: "unknown", path: error.path };
  }

  // No status/path at all means the failure happened before a
  // BirdeyeApiError/HeliusApiError could be constructed — either the
  // `fetch()` call itself rejected (Node's undici throws a `TypeError`,
  // often with a `.cause`, for DNS failures/connection resets/aborts), or
  // `res.json()` threw on a malformed body (`SyntaxError`, a distinct,
  // reliably-checkable native type from a network-level `TypeError`).
  if (error instanceof SyntaxError) return { reason: "parse_error", path: contextPath };
  if (error instanceof TypeError) return { reason: "network_error", path: contextPath };
  return { reason: "unknown", path: contextPath };
}
