import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getSlackClient } from "@/lib/slack/client";
import { getPartnerChatEnv, verifyPartnerChatRequest } from "@/lib/partner-chat/auth";
import {
  appendCustomerPartnerChatMessage,
  getPartnerChatThread,
} from "@/lib/partner-chat/service";
import { buildPartnerChatCustomerFollowUpMessage } from "@/lib/slack/messages/partner-chat";
import type { PartnerChatPartnerType } from "@/lib/partner-chat/types";

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function GET(request: NextRequest) {
  const unauthorized = verifyPartnerChatRequest(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const conversationId = clean(searchParams.get("conversationId"), 120);
  const visitorSessionId = clean(searchParams.get("visitorSessionId"), 120) || null;

  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  const thread = await getPartnerChatThread({
    conversationId,
    visitorSessionId,
  });
  if (!thread) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json(thread);
}

export async function POST(request: NextRequest) {
  const unauthorized = verifyPartnerChatRequest(request);
  if (unauthorized) return unauthorized;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const conversationId = clean(body.conversationId, 120);
  const visitorSessionId = clean(body.visitorSessionId, 120) || null;
  const message = clean(body.message, 4000);

  if (!conversationId || !message) {
    return NextResponse.json(
      { error: "conversationId and message are required" },
      { status: 400 }
    );
  }

  const result = await appendCustomerPartnerChatMessage({
    conversationId,
    visitorSessionId,
    message,
  });

  if (!result) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  if (result.conversation.slackThreadTs) {
    try {
      const slackChannelId =
        result.conversation.slackChannelId ??
        getPartnerChatEnv(result.conversation.partnerType as PartnerChatPartnerType).slackChannelId;
      const slackClient = getSlackClient();
      await slackClient.chat.postMessage({
        channel: slackChannelId,
        thread_ts: result.conversation.slackThreadTs,
        ...buildPartnerChatCustomerFollowUpMessage({
          conversationId,
          customerLabel: result.customerLabel,
          message,
          createdAt: result.message.createdAt,
          threadTs: result.conversation.slackThreadTs,
        }),
      });
    } catch (error) {
      logger.error({ error, conversationId }, "파트너 채팅 추가 메시지 Slack 전송 실패");
    }
  }

  return NextResponse.json({
    message: {
      direction: result.message.direction,
      message: result.message.message,
      createdAt: result.message.createdAt,
    },
  });
}
