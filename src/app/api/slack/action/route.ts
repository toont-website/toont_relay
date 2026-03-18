import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { payload } = result;
  if (!payload) return NextResponse.json({ error: "No payload" }, { status: 400 });

  return new NextResponse(null, { status: 200 });
}
