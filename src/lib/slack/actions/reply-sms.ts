import { getSlackClient } from "@/lib/slack/client";
import { prisma } from "@/lib/db/prisma";
import { formatPhoneNumber, normalizePhoneNumber } from "@/lib/utils/phone";
import { getSmsGatewayClient } from "@/lib/sms-gateway/client";
import { getEnv } from "@/lib/config/env";
import { buildSmsSentMessage } from "@/lib/slack/messages/sms-sent";
import { logger } from "@/lib/logger";
import { getCsToolClient } from "@/lib/cs-tool/client";
import type { CsContact } from "@/lib/cs-tool/types";

export async function handleReplySms(payload: any) {
  const action = payload.actions?.[0];
  const triggerId = payload.trigger_id;

  let phoneNumber: string;
  let threadTs: string | null = null;
  try {
    const parsed = JSON.parse(action?.value ?? "");
    phoneNumber = parsed.phoneNumber;
    threadTs = parsed.threadTs ?? null;
  } catch {
    phoneNumber = action?.value;
  }

  if (!phoneNumber || !triggerId) return;

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

  const displayName = csContact
    ? `${csContact.name} (${formatPhoneNumber(phoneNumber)})`
    : formatPhoneNumber(phoneNumber);

  const recentMessages = await prisma.messageLog.findMany({
    where: { phoneNumber },
    orderBy: { createdAt: "desc" },
    take: 3,
  });

  const contactLabel = csContact?.name ?? formatPhoneNumber(phoneNumber);

  const contextBlocks: any[] = [];
  if (recentMessages.length > 0) {
    contextBlocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*💬 ${contactLabel}님 최근 대화*` },
    });

    for (const msg of [...recentMessages].reverse()) {
      const time = msg.createdAt.toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const isInbound = msg.direction === "inbound";
      const label = isInbound ? `📩 ${contactLabel}님` : "📤 나";
      const preview = msg.message.length > 50
        ? msg.message.substring(0, 50) + "…"
        : msg.message;

      contextBlocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${label}  _${time}_\n>${preview}`,
        },
      });
    }

    contextBlocks.push({ type: "divider" });
  }

  const slackClient = getSlackClient();
  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "sms_send_modal",
      private_metadata: JSON.stringify({ phoneNumber, threadTs }),
      title: { type: "plain_text", text: "답장하기" },
      submit: { type: "plain_text", text: "전송" },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*받는 사람:* ${displayName}` },
        },
        ...contextBlocks,
        {
          type: "input",
          block_id: "message_block",
          label: { type: "plain_text", text: "내용" },
          element: {
            type: "plain_text_input",
            action_id: "message_input",
            multiline: true,
          },
        },
      ],
    },
  });
}

export async function handleRetrySms(payload: any) {
  const action = payload.actions?.[0];
  if (!action?.value) return;

  let parsed: any;
  try {
    parsed = JSON.parse(action.value);
  } catch {
    logger.error("action.value 파싱 실패 (handleRetrySms)");
    return;
  }
  const { phoneNumber, message, threadTs } = parsed;
  const normalized = normalizePhoneNumber(phoneNumber);
  if (!normalized) return;

  const env = getEnv();
  const slackClient = getSlackClient();
  const smsClient = getSmsGatewayClient();

  try {
    const result = await smsClient.sendSMS(normalized, message);

    // CS Tool API로 연락처 조회
    let retryCsContact: CsContact | undefined;
    try {
      const csClient = getCsToolClient();
      const contactResult = await csClient.getContacts({ search: normalized, limit: "5" });
      retryCsContact = (contactResult.data ?? []).find(
        (c) => c.phone && normalizePhoneNumber(c.phone) === normalizePhoneNumber(normalized)
      );
    } catch (error) {
      logger.warn({ phoneNumber: normalized, error }, "CS Tool 연락처 조회 실패 — 미등록 연락처로 처리");
    }

    await prisma.messageLog.create({
      data: {
        direction: "outbound",
        phoneNumber: normalized,
        message,
        status: "sent",
        slackThreadTs: threadTs ?? undefined,
        slackUserId: payload.user.id,
      },
    });

    const recipientName = retryCsContact
      ? `${retryCsContact.name} (${formatPhoneNumber(normalized)})`
      : formatPhoneNumber(normalized);

    await slackClient.chat.postMessage({
      channel: env.SLACK_CHANNEL_CS_SMS,
      thread_ts: threadTs ?? undefined,
      ...buildSmsSentMessage({
        recipientName,
        phoneNumber: normalized,
        message,
        senderUserId: payload.user.id,
        gatewayMessageId: result.id,
      }),
    });
    logger.info({ phoneNumber: normalized }, "SMS 재시도 발신 성공");
  } catch (error) {
    logger.error({ phoneNumber: normalized, error }, "SMS 재시도 발신 실패");
  }
}
