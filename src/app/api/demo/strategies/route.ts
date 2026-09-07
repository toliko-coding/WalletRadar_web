import { NextResponse, type NextRequest } from "next/server";
import { createStrategy, listStrategies } from "@/lib/demo/strategies";
import type { CreateStrategyInput } from "@/lib/demo/types";

export async function GET() {
  const strategies = await listStrategies();
  return NextResponse.json(strategies);
}

export async function POST(request: NextRequest) {
  let body: Partial<CreateStrategyInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (typeof body.startingCapitalUsd !== "number" || body.startingCapitalUsd <= 0) {
    return NextResponse.json({ error: "startingCapitalUsd must be a positive number" }, { status: 400 });
  }

  try {
    const strategy = await createStrategy(body as CreateStrategyInput);
    return NextResponse.json(strategy, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
