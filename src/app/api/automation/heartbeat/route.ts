import { NextResponse, type NextRequest } from "next/server";
import { recordHeartbeat, type RecordHeartbeatInput } from "@/lib/automation/status-data";
import { isJobRequestAuthorized } from "@/lib/jobs/auth";

export async function POST(request: NextRequest) {
  if (!isJobRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RecordHeartbeatInput;
  try {
    body = (await request.json()) as RecordHeartbeatInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.runnerId !== "string" || typeof body.pid !== "number" || typeof body.startedAt !== "string" || !body.config) {
    return NextResponse.json({ error: "runnerId, pid, startedAt, and config are required" }, { status: 400 });
  }

  try {
    await recordHeartbeat(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 502 });
  }
}
