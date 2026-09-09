import { NextResponse, type NextRequest } from "next/server";
import { getAutomationStatus } from "@/lib/automation/status-data";
import { isJobRequestAuthorized } from "@/lib/jobs/auth";

// Read-only, not a mutation — gated anyway for consistency with the other
// automation routes (the runner already sends the header to those, so
// gating this one too costs nothing). The /settings page never calls this
// route: it imports getAutomationStatus() directly, server-side, with no
// HTTP round-trip and no job secret involved (see status-data.ts).
export async function GET(request: NextRequest) {
  if (!isJobRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = await getAutomationStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 502 });
  }
}
