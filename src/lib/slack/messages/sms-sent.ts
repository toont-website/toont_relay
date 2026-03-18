interface SmsSentMessageParams {
  recipientName: string;
  phoneNumber: string;
  message: string;
  senderUserId: string;
  gatewayMessageId: string;
}

export function buildSmsSentMessage(params: SmsSentMessageParams) {
  return {
    text: `SMS 발신: ${params.recipientName}`,
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: `*SMS 발신*\n수신: ${params.recipientName}\n발신자: <@${params.senderUserId}>`,
        },
      },
      { type: "divider" as const },
      {
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: params.message },
      },
      {
        type: "context" as const,
        elements: [
          {
            type: "mrkdwn" as const,
            text: `ID: ${params.gatewayMessageId} | ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
          },
        ],
      },
    ],
  };
}

export function buildSmsFailedMessage(params: {
  recipientName: string;
  phoneNumber: string;
  message: string;
  error: string;
}) {
  return {
    text: `SMS 발송 실패: ${params.recipientName}`,
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: `*SMS 발송 실패*\n수신: ${params.recipientName}\n에러: ${params.error}`,
        },
      },
      {
        type: "actions" as const,
        elements: [
          {
            type: "button" as const,
            text: { type: "plain_text" as const, text: "재시도" },
            action_id: "retry_sms",
            value: JSON.stringify({ phoneNumber: params.phoneNumber, message: params.message }),
            style: "danger" as const,
          },
        ],
      },
    ],
  };
}
