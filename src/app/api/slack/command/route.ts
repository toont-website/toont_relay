import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { params } = result;
  const command = params.get("command");

  if (command === "/문자") {
    return NextResponse.json({ text: "준비 중입니다" });
  }

  return NextResponse.json({ text: `알 수 없는 커맨드: ${command}` });
}
