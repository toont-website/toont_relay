import {
  PARTNER_CHAT_TYPE_LABELS,
  type PartnerChatConversationPayload,
} from "@/lib/partner-chat/types";

function escapeMrkdwn(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatKst(value: Date): string {
  return value.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function buildPartnerChatInquiryMessage(params: PartnerChatConversationPayload) {
  const partnerTypeLabel = PARTNER_CHAT_TYPE_LABELS[params.partnerType];
  const customerLabel = `${params.company} / ${params.contactName}`;
  const fields = [
    ["파트너 유형", partnerTypeLabel],
    ["회사명", params.company],
    ["식별 정보", params.identifier],
    ["담당자", params.contactName],
    ["이메일", params.email],
    ["핸드폰번호", params.phone],
    ["문의 유형", params.inquiryType],
  ];

  return {
    text: `💬 ${partnerTypeLabel} 문의: ${params.company}`,
    attachments: [
      {
        color: "#111111",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `💬 *새 파트너 채팅 문의*\n${escapeMrkdwn(customerLabel)} 님이 ${escapeMrkdwn(partnerTypeLabel)} 문의를 남겼습니다.`,
            },
          },
          {
            type: "section",
            fields: fields.map(([label, value]) => ({
              type: "mrkdwn",
              text: `*${label}*\n${escapeMrkdwn(value)}`,
            })),
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*상세 문의*\n${escapeMrkdwn(params.message)}`,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `접수 시각: ${formatKst(params.createdAt)} · 대화 ID: ${params.conversationId}`,
              },
            ],
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "답장하기" },
                action_id: "reply_partner_chat",
                style: "primary",
                value: JSON.stringify({
                  conversationId: params.conversationId,
                  threadTs: params.threadTs ?? null,
                }),
              },
            ],
          },
        ],
      },
    ],
  };
}

export function buildPartnerChatCustomerFollowUpMessage(params: {
  conversationId: string;
  customerLabel: string;
  message: string;
  createdAt: Date;
}) {
  return {
    text: `💬 ${params.customerLabel} 추가 메시지`,
    attachments: [
      {
        color: "#4B5563",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `💬 *${escapeMrkdwn(params.customerLabel)} 님의 추가 메시지*\n${escapeMrkdwn(params.message)}`,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `전송 시각: ${formatKst(params.createdAt)} · 대화 ID: ${params.conversationId}`,
              },
            ],
          },
        ],
      },
    ],
  };
}

export function buildPartnerChatAgentSentMessage(params: {
  customerLabel: string;
  message: string;
  senderUserId: string;
}) {
  return {
    text: `📤 ${params.customerLabel}에게 파트너 채팅 답장`,
    attachments: [
      {
        color: "#2196F3",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `📤 <@${params.senderUserId}> 님이 ${escapeMrkdwn(params.customerLabel)} 님에게 답장을 보냈어요.`,
            },
          },
          { type: "divider" },
          {
            type: "section",
            text: { type: "mrkdwn", text: escapeMrkdwn(params.message) },
          },
        ],
      },
    ],
  };
}
