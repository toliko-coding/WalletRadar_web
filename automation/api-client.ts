import type { AutomationConfig } from "./config";
// Type-only — erased at compile time, so this never triggers the
// "server-only" runtime guard the actual module carries (verified this
// session: a bare `import type` from a server-only-marked module is safe
// outside Next's bundler, a full runtime import is not).
import type { AutomationStatus, RecordHeartbeatInput } from "@/lib/automation/status-data";

async function authorizedFetch(config: AutomationConfig, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      "x-job-secret": config.jobSecret,
    },
  });
}

export async function fetchStatus(config: AutomationConfig): Promise<AutomationStatus> {
  const res = await authorizedFetch(config, "/api/automation/status");
  if (!res.ok) {
    throw new Error(`GET /api/automation/status failed: ${res.status}`);
  }
  return (await res.json()) as AutomationStatus;
}

/**
 * Returns the parsed response body (previously discarded) — the
 * maintenanceLoop needs to see `{ lockSkipped: true }` to distinguish a
 * lock-skip from a genuine completion for its own heartbeat/log reporting
 * (job_runs itself already correctly has no row for a lock-skip either
 * way — see withMaintenanceLock's doc comment — this is purely about what
 * the runner reports, not about due-state correctness).
 */
export async function postJob(config: AutomationConfig, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await authorizedFetch(config, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function postHeartbeat(config: AutomationConfig, payload: RecordHeartbeatInput): Promise<void> {
  const res = await authorizedFetch(config, "/api/automation/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`POST /api/automation/heartbeat failed: ${res.status}`);
  }
}
