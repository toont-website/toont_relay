import { getSlackClient } from "@/lib/slack/client";
import { prisma } from "@/lib/db/prisma";
import { formatPhoneNumber, normalizePhoneNumber } from "@/lib/utils/phone";
import { getSmsGatewayClient } from "@/lib/sms-gateway/client";
import { getEnv } from "@/lib/config/env";
import { buildSmsSentMessage } from "@/lib/slack/messages/sms-sent";
import { logger } from "@/lib/logger";

export async function handleReplySms(payload: any) {
  const action = payload.actions?.[0];
  const phoneNumber = action?.value;
  const triggerId = payload.trigger_id;
  if (!phoneNumber || !triggerId) return;

  const contact = await prisma.contact.findUnique({ where: { phoneNumber } });
  const displayName = contact
    ? `${contact.name} (${formatPhoneNumber(phoneNumber)})`
    : formatPhoneNumber(phoneNumber);

  const slackClient = getSlackClient();
  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "sms_send_modal",
      private_metadata: JSON.stringify({ phoneNumber }),
      title: { type: "plain_text", text: "답장하기" },
      submit: { type: "plain_text", text: "전송" },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*받는 사람:* ${displayName}` },
        },
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

  const { phoneNumber, message } = JSON.parse(action.value);
  const normalized = normalizePhoneNumber(phoneNumber);
  if (!normalized) return;

  const env = getEnv();
  const slackClient = getSlackClient();
  const smsClient = getSmsGatewayClient();

  try {
    const result = await smsClient.sendSMS(normalized, message);
    const contact = await prisma.contact.findUnique({ where: { phoneNumber: normalized } });

    await prisma.messageLog.create({
      data: { direction: "outbound", phoneNumber: normalized, message, status: "sent", contactId: contact?.id },
    });

    const recipientName = contact
      ? `${contact.name} (${formatPhoneNumber(normalized)})`
      : formatPhoneNumber(normalized);

    await slackClient.chat.postMessage({
      channel: env.SLACK_CHANNEL_CS_SMS,
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
