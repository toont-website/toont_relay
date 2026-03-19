import { formatPhoneNumber } from "@/lib/utils/phone";

interface SmsSentMessageParams {
  recipientName: string;
  phoneNumber: string;
  message: string;
  senderUserId: string;
  gatewayMessageId?: string;
}

export function buildSmsSentMessage(params: SmsSentMessageParams) {
  const { recipientName, phoneNumber, message, senderUserId } = params;

  const time = new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const blocks: any[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*📤 발신* — <@${senderUserId}> → ${recipientName}` },
    },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: message } },
    { type: "context", elements: [{ type: "mrkdwn", text: `📅 ${time}` }] },
  ];

  return {
    text: `SMS 발신 → ${recipientName}`,
    attachments: [{ color: "#2196F3", blocks }],
  };
}

interface SmsFailedMessageParams {
  recipientName: string;
  phoneNumber: string;
  message: string;
  error: string;
  threadTs?: string;
}

export function buildSmsFailedMessage(params: SmsFailedMessageParams) {
  const { recipientName, phoneNumber, message, error, threadTs } = params;

  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*❌ 발송 실패* — ${recipientName} (${formatPhoneNumber(phoneNumber)})\n에러: ${error}`,
      },
    },
    { type: "section", text: { type: "mrkdwn", text: message } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "재시도" },
          action_id: "retry_sms",
          style: "danger",
          value: JSON.stringify({ phoneNumber, message, threadTs: threadTs ?? null }),
        },
      ],
    },
  ];

  return {
    text: `SMS 발송 실패 — ${recipientName}`,
    attachments: [{ color: "#FF3B30", blocks }],
  };
}
