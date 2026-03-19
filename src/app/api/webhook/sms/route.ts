import { NextRequest, NextResponse } from "next/server";
import { getSmsGatewayClient } from "@/lib/sms-gateway/client";
import { getEnv } from "@/lib/config/env";
import { getSlackClient } from "@/lib/slack/client";
import { prisma } from "@/lib/db/prisma";
import { normalizePhoneNumber } from "@/lib/utils/phone";
import { buildSmsReceivedMessage } from "@/lib/slack/messages/sms-received";
import { logger } from "@/lib/logger";
import type { SmsGatewayWebhookEvent } from "@/lib/sms-gateway/types";
import { findActiveThread } from "@/lib/slack/thread/find-thread";

export async function POST(request: NextRequest) {
  const body = await request.text();

  const signature = request.headers.get("x-signature") ?? "";
  const timestamp = request.headers.get("x-timestamp") ?? "";
  const smsClient = getSmsGatewayClient();

  if (!smsClient.verifyWebhookSignature(signature, body, timestamp)) {
    logger.warn({ signature: signature.substring(0, 8) }, "SMS 웹훅 서명 검증 실패");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event: SmsGatewayWebhookEvent = JSON.parse(body);
  logger.debug({ eventType: event.event, payload: event.payload, webhookId: event.webhookId }, "SMS 웹훅 수신");

  if (event.event !== "sms:received") {
    return NextResponse.json({ ok: true });
  }

  const { phoneNumber: rawPhone, message, receivedAt } = event.payload;
  const messageId = event.payload.id ?? event.webhookId;
  const phoneNumber = normalizePhoneNumber(rawPhone) ?? rawPhone;

  // messageId가 없으면 phoneNumber + receivedAt 조합으로 dedup 키 생성
  const dedupKey = messageId
    ? `sms_received_${messageId}`
    : `sms_received_${phoneNumber}_${receivedAt}`;

  const contact = await prisma.contact.findUnique({ where: { phoneNumber } });

  const activeThreadTs = await findActiveThread(phoneNumber);
  const isNewThread = activeThreadTs === null;

  let log;
  try {
    log = await prisma.messageLog.create({
      data: {
        direction: "inbound",
        phoneNumber,
        message,
        status: "received",
        slackActionId: dedupKey,
        contactId: contact?.id,
      },
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      logger.info({ messageId, dedupKey }, "SMS 수신 중복 웹훅 무시");
      return NextResponse.json({ ok: true });
    }
    throw error;
  }

  const env = getEnv();
  const slackClient = getSlackClient();

  const slackMessage = buildSmsReceivedMessage({
    senderName: contact?.name ?? null,
    phoneNumber,
    message,
    receivedAt,
    threadTs: activeThreadTs ?? undefined,
    isNewThread,
  });

  const postResult = await slackClient.chat.postMessage({
    channel: env.SLACK_CHANNEL_CS_SMS,
    thread_ts: activeThreadTs ?? undefined,
    ...slackMessage,
  });

  if (postResult.ts) {
    await prisma.messageLog.update({
      where: { id: log.id },
      data: {
        slackMessageTs: postResult.ts,
        slackThreadTs: activeThreadTs ?? postResult.ts,
      },
    });
  }

  logger.info({ phoneNumber, contactName: contact?.name }, "SMS 수신 처리 완료");
  return NextResponse.json({ ok: true });
}
