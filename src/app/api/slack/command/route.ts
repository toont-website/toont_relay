import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";
import { handleSmsCommand } from "@/lib/slack/commands/sms";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { params } = result;
  const command = params.get("command");
  const triggerId = params.get("trigger_id");

  if ((command === "/문자" || command === "/sms") && triggerId) {
    await handleSmsCommand(triggerId);
    return new NextResponse(null, { status: 200 });
  }

  return NextResponse.json({ text: `알 수 없는 커맨드: ${command}` });
}
