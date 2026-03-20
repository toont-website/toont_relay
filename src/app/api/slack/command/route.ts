import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";
import { handleSmsCommand } from "@/lib/slack/commands/sms";
import { handleContactCommand } from "@/lib/slack/commands/contact";
import { handleInventoryCommand, handleInboundCommand, handleOutboundCommand } from "@/lib/slack/commands/inventory";
import { handleOrderCommand, handleOrderCreateCommand } from "@/lib/slack/commands/order";

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

  if (command === "/contact") {
    const response = await handleContactCommand(text);
    return NextResponse.json(response);
  }

  if (command === "/재고") {
    const response = await handleInventoryCommand(text);
    return NextResponse.json(response);
  }

  if (command === "/입고") {
    const response = await handleInboundCommand(text, userId);
    return NextResponse.json(response);
  }

  if (command === "/출고") {
    const response = await handleOutboundCommand(text, userId);
    return NextResponse.json(response);
  }

  if (command === "/주문") {
    const response = await handleOrderCommand(text);
    return NextResponse.json(response);
  }

  if (command === "/주문추가") {
    const response = await handleOrderCreateCommand(text, userId);
    return NextResponse.json(response);
  }

  return NextResponse.json({ text: `알 수 없는 커맨드: ${command}` });
}
