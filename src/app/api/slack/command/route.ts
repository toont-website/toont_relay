import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";
import { handleSmsCommand } from "@/lib/slack/commands/sms";
import { handleContactCommand } from "@/lib/slack/commands/contact";
import { handleInventoryCommand, handleInboundCommand, handleOutboundCommand } from "@/lib/slack/commands/inventory";
import { handleOrderCommand, handleOrderCreateCommand } from "@/lib/slack/commands/order";
import { handleDashboardCommand } from "@/lib/slack/commands/dashboard";

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

  if (command === "/stock") {
    const response = await handleInventoryCommand(text);
    return NextResponse.json(response);
  }

  if (command === "/stock-in") {
    const response = await handleInboundCommand(triggerId);
    if (response) return NextResponse.json(response);
    return new NextResponse(null, { status: 200 });
  }

  if (command === "/stock-out") {
    const response = await handleOutboundCommand(triggerId);
    if (response) return NextResponse.json(response);
    return new NextResponse(null, { status: 200 });
  }

  if (command === "/order") {
    const response = await handleOrderCommand(text);
    return NextResponse.json(response);
  }

  if (command === "/order-add") {
    const response = await handleOrderCreateCommand(triggerId);
    if (response) return NextResponse.json(response);
    return new NextResponse(null, { status: 200 });
  }

  if (command === "/dashboard") {
    const response = await handleDashboardCommand();
    return NextResponse.json(response);
  }

  return NextResponse.json({ text: `알 수 없는 커맨드: ${command}` });
}
