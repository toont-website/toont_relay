import { getSlackClient } from "../client";
import { getEnv } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { normalizePhoneNumber, formatPhoneNumber } from "@/lib/utils/phone";
import { getSmsGatewayClient } from "@/lib/sms-gateway/client";
import { buildSmsSentMessage, buildSmsFailedMessage } from "../messages/sms-sent";
import { logger } from "@/lib/logger";
import { findActiveThread } from "@/lib/slack/thread/find-thread";

/**
 * /sms 커맨드 핸들러
 * - 인자 없음 → 모달 오픈
 * - /sms [번호|이름] [메시지] → 인라인 발송
 */
export async function handleSmsCommand(
  triggerId: string,
  text: string,
  userId: string,
  channelId: string
) {
  const trimmed = text.trim();

  // 인자 없으면 모달
  if (!trimmed) {
    return openSmsModal(triggerId);
  }

  // 첫 번째 토큰 = 받는 사람, 나머지 = 메시지
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) {
    return { text: "사용법: `/sms [번호 또는 이름] [메시지]`\n예: `/sms 강동현 내일 배송 예정입니다`" };
  }

  const recipientInput = trimmed.slice(0, spaceIdx);
  const message = trimmed.slice(spaceIdx + 1).trim();

  if (!message) {
    return { text: "메시지 내용을 입력하세요.\n예: `/sms 강동현 내일 배송 예정입니다`" };
  }

  // 전화번호인지 확인
  const normalized = normalizePhoneNumber(recipientInput);
  if (normalized) {
    return sendInlineSms(normalized, message, userId);
  }

  // 이름으로 검색
  const contacts = await prisma.contact.findMany({
    where: { name: { contains: recipientInput } },
    take: 10,
  });

  if (contacts.length === 0) {
    return { text: `"${recipientInput}" 검색 결과 없음. 번호로 직접 입력하세요.\n예: \`/sms 010-1234-5678 안녕하세요\`` };
  }

  if (contacts.length === 1) {
    return sendInlineSms(contacts[0].phoneNumber, message, userId);
  }

  // 여러 명 매칭
  const list = contacts
    .map((c, i) => `${i + 1}. ${c.name} (${formatPhoneNumber(c.phoneNumber)})`)
    .join("\n");
  return { text: `"${recipientInput}" 검색 결과 ${contacts.length}명:\n${list}\n\n정확한 이름이나 번호로 다시 입력하세요.` };
}

async function openSmsModal(triggerId: string) {
  const client = getSlackClient();

  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "sms_send_modal",
      title: { type: "plain_text", text: "문자 보내기" },
      submit: { type: "plain_text", text: "전송" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "section",
          block_id: "recipient_block",
          text: { type: "mrkdwn", text: "*받는 사람*" },
          accessory: {
            type: "external_select",
            action_id: "contact_select",
            placeholder: { type: "plain_text", text: "이름 또는 번호 검색..." },
            min_query_length: 1,
          },
        },
        {
          type: "input",
          block_id: "message_block",
          label: { type: "plain_text", text: "내용" },
          element: {
            type: "plain_text_input",
            action_id: "message_input",
            multiline: true,
            placeholder: { type: "plain_text", text: "문자 내용을 입력하세요" },
          },
        },
      ],
    },
  });

  return null; // 모달이니까 슬랙에 텍스트 응답 안 함
}

/**
 * 모달에서 연락처 선택 시 대화 내역을 동적으로 추가
 */
export async function handleContactSelect(payload: any) {
  const selectedOption = payload.actions?.[0]?.selected_option;
  if (!selectedOption) return;

  const phoneNumber = selectedOption.value;
  const displayText = selectedOption.text?.text ?? phoneNumber;
  const viewId = payload.view?.id;
  if (!viewId) return;

  const contact = await prisma.contact.findUnique({ where: { phoneNumber } });

  // 최근 5개 대화 조회
  const recentMessages = await prisma.messageLog.findMany({
    where: { phoneNumber },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  // 스레드 검색
  const activeThreadTs = await findActiveThread(phoneNumber);

  // 대화 내역 블록 생성
  const historyBlocks: any[] = [];
  if (recentMessages.length > 0) {
    historyBlocks.push({ type: "divider" });
    historyBlocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*📋 ${contact?.name ?? formatPhoneNumber(phoneNumber)} 최근 대화*` },
    });

    for (const msg of [...recentMessages].reverse()) {
      const time = msg.createdAt.toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      const icon = msg.direction === "inbound" ? "📩 고객" : "📤 발신";
      const preview = msg.message.length > 60
        ? msg.message.substring(0, 60) + "..."
        : msg.message;

      historyBlocks.push({
        type: "context",
        elements: [
          { type: "mrkdwn", text: `${icon} (${time})\n"${preview}"` },
        ],
      });
    }
  }

  const client = getSlackClient();
  await client.views.update({
    view_id: viewId,
    view: {
      type: "modal",
      callback_id: "sms_send_modal",
      private_metadata: JSON.stringify({ phoneNumber, threadTs: activeThreadTs }),
      title: { type: "plain_text", text: "문자 보내기" },
      submit: { type: "plain_text", text: "전송" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "section",
          block_id: "recipient_block",
          text: { type: "mrkdwn", text: `*받는 사람:* ${displayText}` },
          accessory: {
            type: "external_select",
            action_id: "contact_select",
            placeholder: { type: "plain_text", text: "변경..." },
            min_query_length: 1,
          },
        },
        ...historyBlocks,
        {
          type: "input",
          block_id: "message_block",
          label: { type: "plain_text", text: "내용" },
          element: {
            type: "plain_text_input",
            action_id: "message_input",
            multiline: true,
            placeholder: { type: "plain_text", text: "문자 내용을 입력하세요" },
          },
        },
      ],
    },
  });
}

async function sendInlineSms(phoneNumber: string, message: string, userId: string) {
  const contact = await prisma.contact.findUnique({ where: { phoneNumber } });
  const recipientName = contact
    ? `${contact.name} (${formatPhoneNumber(phoneNumber)})`
    : formatPhoneNumber(phoneNumber);

  const env = getEnv();
  const slackClient = getSlackClient();

  try {
    const smsClient = getSmsGatewayClient();
    const result = await smsClient.sendSMS(phoneNumber, message);

    const activeThreadTs = await findActiveThread(phoneNumber);

    const postResult = await slackClient.chat.postMessage({
      channel: env.SLACK_CHANNEL_CS_SMS,
      thread_ts: activeThreadTs ?? undefined,
      ...buildSmsSentMessage({
        recipientName,
        phoneNumber,
        message,
        senderUserId: userId,
        gatewayMessageId: result.id,
      }),
    });

    await prisma.messageLog.create({
      data: {
        direction: "outbound",
        phoneNumber,
        message,
        status: "sent",
        contactId: contact?.id,
        slackThreadTs: activeThreadTs ?? postResult?.ts ?? undefined,
        slackUserId: userId,
      },
    });

    logger.info({ phoneNumber, gatewayId: result.id }, "SMS 인라인 발신 성공");
    return { text: `SMS 발송 완료: ${recipientName}` };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ phoneNumber, error: errorMsg }, "SMS 인라인 발신 실패");

    const activeThreadTs = await findActiveThread(phoneNumber).catch(() => null);

    await slackClient.chat.postMessage({
      channel: env.SLACK_CHANNEL_CS_SMS,
      thread_ts: activeThreadTs ?? undefined,
      ...buildSmsFailedMessage({
        recipientName,
        phoneNumber,
        message,
        error: errorMsg,
        threadTs: activeThreadTs ?? undefined,
      }),
    });

    return { text: `SMS 발송 실패: ${recipientName}\n에러: ${errorMsg}` };
  }
}
