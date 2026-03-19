import { getEnv } from "@/lib/config/env";
import { getSmsGatewayClient } from "@/lib/sms-gateway/client";
import { getSlackClient } from "@/lib/slack/client";
import { prisma } from "@/lib/db/prisma";
import { normalizePhoneNumber, formatPhoneNumber } from "@/lib/utils/phone";
import { buildSmsSentMessage, buildSmsFailedMessage } from "../messages/sms-sent";
import { logger } from "@/lib/logger";

interface SmsSendValidated {
  phoneNumber: string;
  messageText: string;
  recipientName: string;
  contactId: string | null;
  userId: string;
  slackActionId: string;
  threadTs: string | null;
}

interface SmsSendValidationError {
  response_action: "errors";
  errors: Record<string, string>;
}

export async function validateSmsSend(
  payload: any
): Promise<SmsSendValidated | SmsSendValidationError> {
  const view = payload.view;
  const userId = payload.user.id;
  const slackActionId = `view_${view.id}`;

  let recipientValue =
    view.state?.values?.recipient_block?.contact_select?.selected_option?.value ?? null;

  let threadTs: string | null = null;
  if (view.private_metadata) {
    try {
      const meta = JSON.parse(view.private_metadata);
      recipientValue = recipientValue ?? meta.phoneNumber;
      threadTs = meta.threadTs ?? null;
    } catch { /* ignore */ }
  }

  const messageText = view.state?.values?.message_block?.message_input?.value;

  if (!recipientValue || !messageText) {
    return {
      response_action: "errors",
      errors: {
        ...(!recipientValue && { recipient_block: "받는 사람을 선택하세요" }),
        ...(!messageText && { message_block: "내용을 입력하세요" }),
      },
    };
  }

  const phoneNumber = normalizePhoneNumber(recipientValue);
  if (!phoneNumber) {
    return {
      response_action: "errors",
      errors: { recipient_block: "유효하지 않은 전화번호입니다" },
    };
  }

  const contact = await prisma.contact.findUnique({ where: { phoneNumber } });
  const recipientName = contact
    ? `${contact.name} (${formatPhoneNumber(phoneNumber)})`
    : formatPhoneNumber(phoneNumber);

  return {
    phoneNumber,
    messageText,
    recipientName,
    contactId: contact?.id ?? null,
    userId,
    slackActionId,
    threadTs,
  };
}

export async function executeSmsSend(validated: SmsSendValidated): Promise<void> {
  const { phoneNumber, messageText, recipientName, contactId, userId, slackActionId, threadTs } = validated;

  const env = getEnv();
  const slackClient = getSlackClient();

  try {
    const smsClient = getSmsGatewayClient();
    const result = await smsClient.sendSMS(phoneNumber, messageText);

    const postResult = await slackClient.chat.postMessage({
      channel: env.SLACK_CHANNEL_CS_SMS,
      thread_ts: threadTs ?? undefined,
      ...buildSmsSentMessage({
        recipientName,
        phoneNumber,
        message: messageText,
        senderUserId: userId,
        gatewayMessageId: result.id,
      }),
    });

    // DB 기록 — unique constraint로 중복 방지
    try {
      await prisma.messageLog.create({
        data: {
          direction: "outbound",
          phoneNumber,
          message: messageText,
          status: "sent",
          slackActionId,
          contactId: contactId ?? undefined,
          slackThreadTs: threadTs ?? postResult.ts ?? undefined,
        },
      });
    } catch (dbError: any) {
      if (dbError?.code === "P2002") {
        logger.info({ slackActionId }, "중복 전송 방지됨");
        return;
      }
      throw dbError;
    }

    logger.info({ phoneNumber, gatewayId: result.id }, "SMS 발신 성공");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ phoneNumber, error: errorMsg }, "SMS 발신 실패");

    await slackClient.chat.postMessage({
      channel: env.SLACK_CHANNEL_CS_SMS,
      thread_ts: threadTs ?? undefined,
      ...buildSmsFailedMessage({
        recipientName,
        phoneNumber,
        message: messageText,
        error: errorMsg,
        threadTs: threadTs ?? undefined,
      }),
    });

    await prisma.messageLog.create({
      data: {
        direction: "outbound",
        phoneNumber,
        message: messageText,
        status: "failed",
        slackActionId: `${slackActionId}_failed`,
        contactId: contactId ?? undefined,
        slackThreadTs: threadTs ?? undefined,
      },
    });
  }
}
