import { NextRequest, NextResponse } from "next/server";
import { getSmsGatewayClient } from "@/lib/sms-gateway/client";
import { getEnv } from "@/lib/config/env";
import { getSlackClient } from "@/lib/slack/client";
import { prisma } from "@/lib/db/prisma";
import { normalizePhoneNumber } from "@/lib/utils/phone";
import { buildSmsReceivedMessage } from "@/lib/slack/messages/sms-received";
import { logger } from "@/lib/logger";
import type { SmsGatewayWebhookEvent } from "@/lib/sms-gateway/types";

export async function POST(request: NextRequest) {
  const body = await request.text();

  const signature = request.headers.get("x-signature") ?? "";
  const smsClient = getSmsGatewayClient();

  if (!smsClient.verifyWebhookSignature(signature, body)) {
    logger.warn({ signature }, "SMS 웹훅 서명 검증 실패");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event: SmsGatewayWebhookEvent = JSON.parse(body);

  if (event.event !== "sms:received") {
    return NextResponse.json({ ok: true });
  }

  const { phoneNumber: rawPhone, message, receivedAt } = event.payload;
  const phoneNumber = normalizePhoneNumber(rawPhone) ?? rawPhone;

  const contact = await prisma.contact.findUnique({ where: { phoneNumber } });

  const log = await prisma.messageLog.create({
    data: {
      direction: "inbound",
      phoneNumber,
      message,
      status: "received",
      contactId: contact?.id,
    },
  });

  const env = getEnv();
  const slackClient = getSlackClient();

  const slackMessage = buildSmsReceivedMessage({
    senderName: contact?.name ?? null,
    phoneNumber,
    message,
    receivedAt,
  });

  const postResult = await slackClient.chat.postMessage({
    channel: env.SLACK_CHANNEL_CS_SMS,
    ...slackMessage,
  });

  if (postResult.ts) {
    await prisma.messageLog.update({
      where: { id: log.id },
      data: { slackMessageTs: postResult.ts },
    });
  }

  logger.info({ phoneNumber, contactName: contact?.name }, "SMS 수신 처리 완료");
  return NextResponse.json({ ok: true });
}
