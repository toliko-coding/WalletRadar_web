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

export async function postJob(config: AutomationConfig, path: string, body?: unknown): Promise<void> {
  const res = await authorizedFetch(config, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
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
