import "server-only";
import { requireHeliusApiKey } from "@/lib/env";
import { TokenBucket, withRetry } from "@/lib/rate-limit/token-bucket";
import { recordProviderUsage } from "@/lib/telemetry/provider-usage-data";

const BASE_URL = "https://mainnet.helius-rpc.com";

// Conservative default; Helius free/developer tiers comfortably allow this.
const bucket = new TokenBucket(5, 5);

export class HeliusApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string
  ) {
    super(message);
    this.name = "HeliusApiError";
  }
}

export async function heliusGet<T>(
  path: string,
  query: Record<string, string | number | undefined> = {}
): Promise<T> {
  const apiKey = requireHeliusApiKey();
  const url = new URL(path, BASE_URL);
  url.searchParams.set("api-key", apiKey);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  await bucket.take();

  // See the matching comment in birdeye/client.ts — same reasoning applies
  // here: one recordProviderUsage call per top-level heliusGet, covering
  // whatever withRetry actually did internally.
  let attempts = 0;
  let succeeded = false;
  try {
    const result = await withRetry(async () => {
      attempts += 1;
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new HeliusApiError(`Helius GET ${path} failed: ${res.status} ${text}`, res.status, path);
      }
      return (await res.json()) as T;
    });
    succeeded = true;
    return result;
  } finally {
    await recordProviderUsage("helius", {
      outboundAttempts: attempts,
      retries: Math.max(0, attempts - 1),
      successfulRequests: succeeded ? 1 : 0,
    });
  }
}
