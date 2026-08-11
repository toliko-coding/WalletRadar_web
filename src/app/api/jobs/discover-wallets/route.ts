import { NextResponse, type NextRequest } from "next/server";
import { runDiscoverWallets } from "@/lib/jobs/discover-wallets";
import { isJobRequestAuthorized } from "@/lib/jobs/auth";
import { isBirdeyeConfigured } from "@/lib/env";

export async function POST(request: NextRequest) {
  if (!isJobRequestAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isBirdeyeConfigured()) {
    return NextResponse.json(
      { error: "BIRDEYE_API_KEY is not configured. Add it to .env.local." },
      { status: 503 }
    );
  }

  const result = await runDiscoverWallets();
  return NextResponse.json(result);
}
