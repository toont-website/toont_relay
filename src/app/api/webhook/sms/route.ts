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
import { getCsToolClient } from "@/lib/cs-tool/client";
import type { CsContact } from "@/lib/cs-tool/types";

export async function POST(request: NextRequest) {
  const body = await request.text();

  const signature = request.headers.get("x-signature") ?? "";
  const timestamp = request.headers.get("x-timestamp") ?? "";
  const smsClient = getSmsGatewayClient();

  if (!smsClient.verifyWebhookSignature(signature, body, timestamp)) {
    logger.warn({ signature: signature.substring(0, 8) }, "SMS 웹훅 서명 검증 실패");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: SmsGatewayWebhookEvent;
  try {
    event = JSON.parse(body);
  } catch {
    logger.error("SMS 웹훅 body 파싱 실패");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  logger.info({ eventType: event.event, payloadKeys: Object.keys(event.payload ?? {}), webhookId: event.webhookId }, "SMS 웹훅 수신");

  if (event.event !== "sms:received") {
    return NextResponse.json({ ok: true });
  }

  const { phoneNumber: rawPhone, message, receivedAt } = event.payload;
  const phoneNumber = normalizePhoneNumber(rawPhone) ?? rawPhone;

  // 30초 내 동일 번호 + 동일 내용이면 중복으로 판단
  const recentDuplicate = await prisma.messageLog.findFirst({
    where: {
      direction: "inbound",
      phoneNumber,
      message,
      createdAt: { gte: new Date(Date.now() - 30_000) },
    },
  });

  if (recentDuplicate) {
    logger.info({ phoneNumber }, "SMS 수신 중복 웹훅 무시");
    return NextResponse.json({ ok: true });
  }

  // CS Tool API로 연락처 조회
  let csContact: CsContact | undefined;
  try {
    const csClient = getCsToolClient();
    const contactResult = await csClient.getContacts({ search: phoneNumber, limit: "5" });
    csContact = (contactResult.data ?? []).find(
      (c) => c.phone && normalizePhoneNumber(c.phone) === normalizePhoneNumber(phoneNumber)
    );
  } catch (error) {
    logger.warn({ phoneNumber, error }, "CS Tool 연락처 조회 실패 — 미등록 연락처로 처리");
  }

  const activeThreadTs = await findActiveThread(phoneNumber);
  const isNewThread = activeThreadTs === null;

  // 마지막 발신 담당자 조회
  const lastOutbound = await prisma.messageLog.findFirst({
    where: {
      phoneNumber,
      direction: "outbound",
      slackUserId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { slackUserId: true },
  });

  const log = await prisma.messageLog.create({
    data: {
      direction: "inbound",
      phoneNumber,
      message,
      status: "received",
    },
  });

  const env = getEnv();
  const slackClient = getSlackClient();

  const slackMessage = buildSmsReceivedMessage({
    senderName: csContact?.name ?? null,
    phoneNumber,
    message,
    receivedAt,
    threadTs: activeThreadTs ?? undefined,
    isNewThread,
    lastAgentUserId: lastOutbound?.slackUserId ?? undefined,
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

  logger.info({ phoneNumber, contactName: csContact?.name }, "SMS 수신 처리 완료");
  return NextResponse.json({ ok: true });
}
