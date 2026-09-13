import { NextResponse, type NextRequest } from "next/server";
import { runAnalyzeRefreshWallets } from "@/lib/jobs/analyze-candidates";
import { isJobRequestAuthorized } from "@/lib/jobs/auth";
import { isBirdeyeConfigured, isHeliusConfigured } from "@/lib/env";

export async function POST(request: NextRequest) {
  if (!isJobRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isBirdeyeConfigured() || !isHeliusConfigured()) {
    return NextResponse.json(
      { error: "BIRDEYE_API_KEY and HELIUS_API_KEY must both be configured. Add them to .env.local." },
      { status: 503 }
    );
  }

  let limit = 10;
  let stalenessHours = 24;
  try {
    const body = (await request.json()) as { limit?: unknown; stalenessHours?: unknown };
    if (typeof body.limit === "number" && body.limit > 0) {
      limit = Math.min(Math.floor(body.limit), 25);
    }
    if (typeof body.stalenessHours === "number" && body.stalenessHours > 0) {
      stalenessHours = body.stalenessHours;
    }
  } catch {
    // No/invalid JSON body — fall back to the defaults.
  }

  const result = await runAnalyzeRefreshWallets(limit, stalenessHours);
  return NextResponse.json(result);
}
