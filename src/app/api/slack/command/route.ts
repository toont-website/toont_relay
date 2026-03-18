import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";
import { handleSmsCommand } from "@/lib/slack/commands/sms";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { params } = result;
  const command = params.get("command");
  const triggerId = params.get("trigger_id") ?? "";
  const text = params.get("text") ?? "";
  const userId = params.get("user_id") ?? "";
  const channelId = params.get("channel_id") ?? "";

  if (command === "/문자" || command === "/sms") {
    const response = await handleSmsCommand(triggerId, text, userId, channelId);
    if (response) return NextResponse.json(response);
    return new NextResponse(null, { status: 200 });
  }

  return NextResponse.json({ text: `알 수 없는 커맨드: ${command}` });
}
