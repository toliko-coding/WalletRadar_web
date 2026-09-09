import "server-only";
import { requireBirdeyeApiKey } from "@/lib/env";
import { TokenBucket, withRetry } from "@/lib/rate-limit/token-bucket";
import { recordProviderUsage } from "@/lib/telemetry/provider-usage-data";

const BASE_URL = "https://public-api.birdeye.so";

// Standard (free) tier is 1 rps — safe default; override via env later if the
// account is upgraded (§47 rate-limit strategy).
const bucket = new TokenBucket(1, 1);

export class BirdeyeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string
  ) {
    super(message);
    this.name = "BirdeyeApiError";
  }
}

interface BirdeyeRequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  chain?: string;
}

export async function birdeyeRequest<T>(
  path: string,
  opts: BirdeyeRequestOptions = {}
): Promise<T> {
  const apiKey = requireBirdeyeApiKey();
  const url = new URL(path, BASE_URL);

  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  await bucket.take();

  // Telemetry (Provider Usage Telemetry, migration 0005): `attempts` counts
  // every real fetch below, including retries withRetry performs
  // internally — one recordProviderUsage call per top-level birdeyeRequest,
  // not per attempt, fired from `finally` so it covers both the success and
  // final-failure paths. Does not alter retry/rate-limit behavior at all;
  // see recordProviderUsage's own doc comment for why this can never throw.
  let attempts = 0;
  let succeeded = false;
  try {
    const result = await withRetry(async () => {
      attempts += 1;
      const res = await fetch(url.toString(), {
        method: opts.method ?? "GET",
        headers: {
          "X-API-KEY": apiKey,
          "x-chain": opts.chain ?? "solana",
          ...(opts.body ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new BirdeyeApiError(
          `Birdeye ${opts.method ?? "GET"} ${path} failed: ${res.status} ${text}`,
          res.status,
          path
        );
      }

      const json = (await res.json()) as { success: boolean; data: T };
      if (!json.success) {
        throw new BirdeyeApiError(`Birdeye ${path} returned success=false`, res.status, path);
      }
      return json.data;
    });
    succeeded = true;
    return result;
  } finally {
    await recordProviderUsage("birdeye", {
      outboundAttempts: attempts,
      retries: Math.max(0, attempts - 1),
      successfulRequests: succeeded ? 1 : 0,
    });
  }
}
