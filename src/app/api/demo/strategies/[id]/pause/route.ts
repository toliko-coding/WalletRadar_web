import { NextResponse } from "next/server";
import { setStrategyStatus } from "@/lib/demo/strategies";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await setStrategyStatus(id, "PAUSED");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 502 });
  }
}
