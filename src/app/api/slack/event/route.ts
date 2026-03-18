import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { body } = result;
  try {
    const parsed = JSON.parse(body);
    if (parsed.type === "url_verification") {
      return NextResponse.json({ challenge: parsed.challenge });
    }
  } catch {
    // not JSON, ignore
  }

  return NextResponse.json({ ok: true });
}
