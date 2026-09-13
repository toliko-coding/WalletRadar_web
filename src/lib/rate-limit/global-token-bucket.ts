import { TokenBucket } from "./token-bucket";

/**
 * Returns a process-wide singleton TokenBucket for `key`, surviving module
 * re-instantiation within the same Node process. A plain module-level
 * `const bucket = new TokenBucket(...)` (the previous approach in
 * birdeye/client.ts and helius/client.ts) is not provably safe against
 * Next.js/Turbopack bundling the same module into more than one chunk, or
 * dev-mode HMR re-executing it — either could silently produce two
 * independent buckets, each individually enforcing its own rate, for an
 * invisible effective doubling. Storing the instance on `globalThis` under a
 * namespaced key guarantees every possible module copy in the same process
 * resolves to the exact same object — the same pattern already standard for
 * avoiding duplicate PrismaClient instances under Next.js dev/HMR.
 *
 * Does NOT solve multi-process/serverless deployments: `globalThis` is
 * itself per-process, so N separate server processes still get N separate
 * buckets. Distributed/shared rate limiting (e.g. a DB-backed token count)
 * remains an explicit deferral — not needed while this app stays
 * local/single-instance, per the Corrective Phase plan.
 */
export function getGlobalTokenBucket(key: string, capacity: number, refillPerSecond: number): TokenBucket {
  const globalKey = `__walletradar_token_bucket__${key}` as const;
  const globalStore = globalThis as unknown as Record<string, TokenBucket | undefined>;
  if (!globalStore[globalKey]) {
    globalStore[globalKey] = new TokenBucket(capacity, refillPerSecond);
  }
  return globalStore[globalKey];
}
