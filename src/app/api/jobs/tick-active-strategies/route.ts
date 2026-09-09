import { NextResponse, type NextRequest } from "next/server";
import { tickActiveStrategies } from "@/lib/demo/tick-active-strategies";
import { isJobRequestAuthorized } from "@/lib/jobs/auth";
import { isBirdeyeConfigured } from "@/lib/env";

export async function POST(request: NextRequest) {
  if (!isJobRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isBirdeyeConfigured()) {
    return NextResponse.json(
      { error: "BIRDEYE_API_KEY is not configured — a tick needs live prices for any signal/position it processes." },
      { status: 503 }
    );
  }

  try {
    const result = await tickActiveStrategies();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 502 });
  }
}
