import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";
import { handleSmsCommand } from "@/lib/slack/commands/sms";
import { handleContactCommand, openContactAddModal } from "@/lib/slack/commands/contact";
import { handleContactTypeCommand } from "@/lib/slack/commands/contact-type";
import { handleInventoryCommand, handleInboundCommand, handleOutboundCommand } from "@/lib/slack/commands/inventory";
import { handleOrderCommand, handleOrderCreateCommand } from "@/lib/slack/commands/order";
import { handleDashboardCommand } from "@/lib/slack/commands/dashboard";
import { postToResponseUrl } from "@/lib/slack/deferred-response";
import { logger } from "@/lib/logger";

const LOADING_RESPONSE = {
  response_type: "ephemeral" as const,
  text: "⏳ 처리 중...",
};

/**
 * 무거운 커맨드를 deferred 처리
 * 즉시 "처리 중..." 응답 → after()에서 실제 처리 → response_url로 결과 전송
 */
function deferCommand(
  responseUrl: string,
  command: string,
  handler: () => Promise<Record<string, unknown>>
): NextResponse {
  after(async () => {
    try {
      const response = await handler();
      await postToResponseUrl(responseUrl, response);
    } catch (error) {
      logger.error({ error, command }, "deferred command 실패");
      await postToResponseUrl(responseUrl, {
        response_type: "ephemeral",
        text: "처리 중 에러가 발생했어요.",
      });
    }
  });
  return NextResponse.json(LOADING_RESPONSE);
}

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { params } = result;
  const command = params.get("command");
  const triggerId = params.get("trigger_id") ?? "";
  const text = params.get("text") ?? "";
  const userId = params.get("user_id") ?? "";
  const channelId = params.get("channel_id") ?? "";
  const responseUrl = params.get("response_url") ?? "";

  if (command === "/문자" || command === "/sms") {
    if (!text.trim()) {
      // 모달 오픈은 trigger_id 필요 → 동기 처리
      const response = await handleSmsCommand(triggerId, text, userId, channelId);
      if (response) return NextResponse.json(response);
      return new NextResponse(null, { status: 200 });
    }
    // 인라인 SMS 발송은 deferred
    return deferCommand(responseUrl, command, async () => {
      const response = await handleSmsCommand(triggerId, text, userId, channelId);
      return response ?? { text: "완료" };
    });
  }

  if (command === "/contact") {
    if (text.trim() === "추가") {
      await openContactAddModal(triggerId);
      return new NextResponse(null, { status: 200 });
    }
    return deferCommand(responseUrl, command, () => handleContactCommand(text));
  }

  if (command === "/contact-type") {
    return deferCommand(responseUrl, command, () => handleContactTypeCommand(text));
  }

  if (command === "/stock") {
    return deferCommand(responseUrl, command, () => handleInventoryCommand(text));
  }

  // 모달 오픈 → trigger_id 필요 → 동기 유지
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
    return deferCommand(responseUrl, command, () => handleOrderCommand(text));
  }

  // 모달 오픈 → trigger_id 필요 → 동기 유지
  if (command === "/order-add") {
    const response = await handleOrderCreateCommand(triggerId);
    if (response) return NextResponse.json(response);
    return new NextResponse(null, { status: 200 });
  }

  if (command === "/dashboard") {
    return deferCommand(responseUrl, command, () => handleDashboardCommand());
  }

  return NextResponse.json({ text: `알 수 없는 커맨드: ${command}` });
}
