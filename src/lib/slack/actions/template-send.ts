import { getCsToolClient } from "@/lib/cs-tool/client";
import { getSlackClient } from "@/lib/slack/client";
import { getSmsGatewayClient } from "@/lib/sms-gateway/client";
import { normalizePhoneNumber } from "@/lib/utils/phone";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/config/env";
import { buildSmsSentMessage, buildSmsFailedMessage } from "@/lib/slack/messages/sms-sent";
import { logger } from "@/lib/logger";

// 📋 복사 버튼 → response_url로 특정 템플릿 텍스트 전달
export async function handleCopyTemplate(orderId: string, responseUrl: string, templateIndex?: number) {
  const { postToResponseUrl } = await import("@/lib/slack/deferred-response");
  const client = getCsToolClient();
  const order = await client.getOrder(orderId);
  if (!order.data || !responseUrl) return;

  const templates = order.data.currentStageTemplates;
  if (templates.length === 0) return;

  const idx = templateIndex ?? 0;
  const template = templates[idx];
  if (!template) return;

  await postToResponseUrl(responseUrl, {
    response_type: "ephemeral",
    replace_original: false,
    text: `*[${template.contactTypeName} — ${template.label}]*\n${template.text}`,
  });
}

// 📨 보내기 버튼 → SMS 발송 모달 (특정 템플릿 미리 채움)
export async function openTemplateSendModal(triggerId: string, orderId: string, templateIndex?: number) {
  const client = getCsToolClient();
  const slackClient = getSlackClient();
  const order = await client.getOrder(orderId);
  if (!order.data) return;

  const idx = templateIndex ?? 0;
  const template = order.data.currentStageTemplates[idx];
  if (!template) return;

  const contact = order.data.contacts.find((c) => c.type === template.contactType);
  const phone = contact?.phone ?? order.data.phone ?? "";

  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "template_sms_modal",
      private_metadata: JSON.stringify({ orderId, phone, contactName: contact?.name }),
      title: { type: "plain_text", text: "문자 발송" },
      submit: { type: "plain_text", text: "발송" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `📨 *${template.contactTypeName}* → ${template.label}` },
          ],
        },
        {
          type: "input",
          block_id: "phone_block",
          label: { type: "plain_text", text: "수신 번호" },
          element: {
            type: "plain_text_input",
            action_id: "phone_input",
            initial_value: phone,
          },
        },
        {
          type: "input",
          block_id: "message_block",
          label: { type: "plain_text", text: "메시지 (수정 가능)" },
          element: {
            type: "plain_text_input",
            action_id: "message_input",
            multiline: true,
            initial_value: template.text,
          },
        },
      ],
    },
  });
}

// 발송 제출 → 컨펌 모달 (push)
export async function validateTemplateSms(payload: any) {
  const values = payload.view.state.values;
  const phone = values.phone_block.phone_input.value;
  const message = values.message_block.message_input.value;
  let metadata: any;
  try {
    metadata = JSON.parse(payload.view.private_metadata);
  } catch {
    logger.error("private_metadata 파싱 실패 (validateTemplateSms)");
    return null;
  }

  if (!phone || !message) {
    return {
      response_action: "errors",
      errors: {
        ...(phone ? {} : { phone_block: "수신 번호를 입력해주세요." }),
        ...(message ? {} : { message_block: "메시지를 입력해주세요." }),
      },
    };
  }

  const normalized = normalizePhoneNumber(phone);
  if (!normalized) {
    return {
      response_action: "errors",
      errors: { phone_block: "유효한 전화번호를 입력해주세요." },
    };
  }

  // 컨펌 모달로 전환 (push)
  return {
    response_action: "push",
    view: {
      type: "modal",
      callback_id: "template_sms_confirm",
      private_metadata: JSON.stringify({ ...metadata, phone: normalized, message }),
      title: { type: "plain_text", text: "발송 확인" },
      submit: { type: "plain_text", text: "발송" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*수신:* ${phone}\n*내용:*\n> ${message.replace(/\n/g, "\n> ")}`,
          },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: "⚠️ 이 내용으로 문자를 발송하시겠습니까?" },
        },
      ],
    },
  };
}

// 컨펌 후 실제 발송
export async function executeTemplateSms(payload: any) {
  let metadata: any;
  try {
    metadata = JSON.parse(payload.view.private_metadata);
  } catch {
    logger.error("private_metadata 파싱 실패 (executeTemplateSms)");
    return;
  }
  const { phone, message, orderId, contactName } = metadata;
  const userId = payload.user.id;
  const slackActionId = `template_${payload.view.id}`;

  const smsClient = getSmsGatewayClient();
  const slackClient = getSlackClient();
  const env = getEnv();

  const recipientName = contactName ?? phone;

  try {
    const result = await smsClient.sendSMS(phone, message);

    await slackClient.chat.postMessage({
      channel: env.SLACK_CHANNEL_CS_SMS,
      ...buildSmsSentMessage({
        recipientName,
        phoneNumber: phone,
        message,
        senderUserId: userId,
        gatewayMessageId: result.id,
      }),
    });

    try {
      await prisma.messageLog.create({
        data: {
          direction: "outbound",
          phoneNumber: phone,
          message,
          status: "sent",
          slackActionId,
          slackUserId: userId,
        },
      });
    } catch (dbError: any) {
      if (dbError?.code === "P2002") {
        logger.info({ slackActionId }, "중복 전송 방지됨");
        return;
      }
      throw dbError;
    }

    logger.info({ phone, orderId, userId }, "템플릿 SMS 발송 완료");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ phone, orderId, error: errorMsg }, "템플릿 SMS 발송 실패");

    await slackClient.chat.postMessage({
      channel: env.SLACK_CHANNEL_CS_SMS,
      ...buildSmsFailedMessage({
        recipientName,
        phoneNumber: phone,
        message,
        error: errorMsg,
      }),
    });

    try {
      await prisma.messageLog.create({
        data: {
          direction: "outbound",
          phoneNumber: phone,
          message,
          status: "failed",
          slackActionId: `${slackActionId}_failed`,
          slackUserId: userId,
        },
      });
    } catch (dbError) {
      logger.error({ dbError }, "실패 로그 저장 실패");
    }
  }
}
