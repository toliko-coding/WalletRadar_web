import { NextResponse } from "next/server";
import { runDemoTick } from "@/lib/demo/run-tick";
import { isBirdeyeConfigured } from "@/lib/env";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!isBirdeyeConfigured()) {
    return NextResponse.json(
      { error: "BIRDEYE_API_KEY is not configured — the tick needs live prices for any signal/position it processes." },
      { status: 503 }
    );
  }

  try {
    const result = await runDemoTick(id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 502 });
  }
}
