import { NextResponse, type NextRequest } from "next/server";
import { analyzeWallet, isValidSolanaAddress } from "@/lib/analysis/analyze-wallet";
import { isBirdeyeConfigured, isHeliusConfigured } from "@/lib/env";

export async function POST(
  request: NextRequest,
  { params }: RouteContext<"/api/wallet/[address]/analyze">
) {
  const { address } = await params;

  if (!isValidSolanaAddress(address)) {
    return NextResponse.json({ error: "Invalid Solana wallet address" }, { status: 400 });
  }

  if (!isBirdeyeConfigured() || !isHeliusConfigured()) {
    return NextResponse.json(
      {
        error:
          "Provider API keys are not configured. Add BIRDEYE_API_KEY and HELIUS_API_KEY to .env.local.",
      },
      { status: 503 }
    );
  }

  const windowLabel = request.nextUrl.searchParams.get("window") ?? "90D";

  try {
    const analysis = await analyzeWallet(address, windowLabel);
    return NextResponse.json(analysis);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
