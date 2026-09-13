import "server-only";
import { requireHeliusApiKey } from "@/lib/env";
import { withRetry } from "@/lib/rate-limit/token-bucket";
import { getGlobalTokenBucket } from "@/lib/rate-limit/global-token-bucket";
import { recordProviderUsage } from "@/lib/telemetry/provider-usage-data";
import { classifyProviderError } from "@/lib/providers/error-classification";
import type { RetryReasonCounts } from "@/lib/telemetry/provider-usage";

const BASE_URL = "https://mainnet.helius-rpc.com";

// Conservative default; Helius free/developer tiers comfortably allow this.
// Stored on globalThis for the same singleton-identity reasoning as the
// Birdeye bucket — see global-token-bucket.ts's doc comment.
const bucket = getGlobalTokenBucket("helius", 5, 5);

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
  // whatever withRetry actually did internally. retryReasons is the same
  // pure diagnostic classification, never influencing retry behavior.
  let attempts = 0;
  let succeeded = false;
  const retryReasons: RetryReasonCounts = {};
  try {
    const result = await withRetry(
      async () => {
        attempts += 1;
        const res = await fetch(url.toString(), { cache: "no-store" });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new HeliusApiError(`Helius GET ${path} failed: ${res.status} ${text}`, res.status, path);
        }
        return (await res.json()) as T;
      },
      {
        onRetry: (error) => {
          const { reason, path: classifiedPath } = classifyProviderError(error, path);
          const pathCounts = retryReasons[reason] ?? {};
          pathCounts[classifiedPath] = (pathCounts[classifiedPath] ?? 0) + 1;
          retryReasons[reason] = pathCounts;
        },
      }
    );
    succeeded = true;
    return result;
  } finally {
    await recordProviderUsage("helius", {
      outboundAttempts: attempts,
      retries: Math.max(0, attempts - 1),
      successfulRequests: succeeded ? 1 : 0,
      retryReasons,
    });
  }
}
