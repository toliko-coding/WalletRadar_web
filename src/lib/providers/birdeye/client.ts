import "server-only";
import { requireBirdeyeApiKey } from "@/lib/env";
import { TokenBucket, withRetry } from "@/lib/rate-limit/token-bucket";

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

  return withRetry(async () => {
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
}
