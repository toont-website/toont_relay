import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getSlackClient } from "@/lib/slack/client";
import { getPartnerChatEnv, verifyPartnerChatRequest } from "@/lib/partner-chat/auth";
import {
  createPartnerChatConversation,
  getPartnerChatConversationPayload,
  markPartnerChatSlackThread,
} from "@/lib/partner-chat/service";
import { buildPartnerChatInquiryMessage } from "@/lib/slack/messages/partner-chat";
import type { PartnerChatInquiryInput, PartnerChatPartnerType } from "@/lib/partner-chat/types";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PARTNER_TYPES = new Set<PartnerChatPartnerType>(["expert", "supplier"]);

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseInquiry(body: Record<string, unknown>): PartnerChatInquiryInput | { error: string } {
  const partnerType = clean(body.partnerType, 32) as PartnerChatPartnerType;
  const input: PartnerChatInquiryInput = {
    partnerType,
    company: clean(body.company, 120),
    identifier: clean(body.identifier, 120),
    contactName: clean(body.contactName, 80),
    email: clean(body.email, 160).toLowerCase(),
    phone: clean(body.phone, 80),
    inquiryType: clean(body.inquiryType, 120),
    message: clean(body.message, 4000),
    visitorSessionId: clean(body.visitorSessionId, 120) || null,
  };

  if (!PARTNER_TYPES.has(input.partnerType)) {
    return { error: "유효하지 않은 파트너 유형입니다." };
  }
  if (
    !input.company ||
    !input.identifier ||
    !input.contactName ||
    !input.email ||
    !input.phone ||
    !input.inquiryType ||
    !input.message
  ) {
    return { error: "필수 항목을 모두 입력해주세요." };
  }
  if (!EMAIL_REGEX.test(input.email)) {
    return { error: "유효한 이메일을 입력해주세요." };
  }

  return input;
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

  const input = parseInquiry(body);
  if ("error" in input) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const partnerChatEnv = getPartnerChatEnv();
  const slackClient = getSlackClient();

  try {
    const conversation = await createPartnerChatConversation(input);
    const payload = await getPartnerChatConversationPayload(conversation.id);
    if (!payload) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 500 });
    }

    const postResult = await slackClient.chat.postMessage({
      channel: partnerChatEnv.slackChannelId,
      ...buildPartnerChatInquiryMessage(payload),
    });

    await markPartnerChatSlackThread({
      conversationId: conversation.id,
      slackChannelId: partnerChatEnv.slackChannelId,
      slackMessageTs: postResult.ts,
      slackThreadTs: postResult.ts,
    });

    logger.info({ conversationId: conversation.id }, "파트너 채팅 문의 Slack 전송 완료");
    return NextResponse.json({
      conversationId: conversation.id,
      status: "open",
    });
  } catch (error) {
    logger.error({ error }, "파트너 채팅 문의 처리 실패");
    return NextResponse.json(
      { error: "파트너 채팅 문의 접수 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
