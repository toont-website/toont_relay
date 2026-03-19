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

  const recipientValue =
    view.state?.values?.recipient_block?.contact_select?.selected_option?.value
    ?? (view.private_metadata ? JSON.parse(view.private_metadata).phoneNumber : null);

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
  };
}

export async function executeSmsSend(validated: SmsSendValidated): Promise<void> {
  const { phoneNumber, messageText, recipientName, contactId, userId, slackActionId } = validated;

  const env = getEnv();
  const slackClient = getSlackClient();

  try {
    const smsClient = getSmsGatewayClient();
    const result = await smsClient.sendSMS(phoneNumber, messageText);

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
        },
      });
    } catch (dbError: any) {
      if (dbError?.code === "P2002") {
        logger.info({ slackActionId }, "중복 전송 방지됨");
        return;
      }
      throw dbError;
    }

    await slackClient.chat.postMessage({
      channel: env.SLACK_CHANNEL_CS_SMS,
      ...buildSmsSentMessage({
        recipientName,
        phoneNumber,
        message: messageText,
        senderUserId: userId,
        gatewayMessageId: result.id,
      }),
    });

    logger.info({ phoneNumber, gatewayId: result.id }, "SMS 발신 성공");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ phoneNumber, error: errorMsg }, "SMS 발신 실패");

    await slackClient.chat.postMessage({
      channel: env.SLACK_CHANNEL_CS_SMS,
      ...buildSmsFailedMessage({
        recipientName,
        phoneNumber,
        message: messageText,
        error: errorMsg,
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
      },
    });
  }
}
