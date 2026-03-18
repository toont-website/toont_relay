import { formatPhoneNumber } from "@/lib/utils/phone";

interface SmsReceivedMessageParams {
  senderName: string | null;
  phoneNumber: string;
  message: string;
  receivedAt: string;
}

export function buildSmsReceivedMessage(params: SmsReceivedMessageParams) {
  const displayName = params.senderName
    ? `${params.senderName} (${formatPhoneNumber(params.phoneNumber)})`
    : formatPhoneNumber(params.phoneNumber);

  const time = new Date(params.receivedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  return {
    text: `SMS 수신: ${displayName}`,
    blocks: [
      {
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: `*SMS 수신*\n발신: ${displayName}\n시간: ${time}` },
      },
      { type: "divider" as const },
      {
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: params.message },
      },
      {
        type: "actions" as const,
        elements: [
          {
            type: "button" as const,
            text: { type: "plain_text" as const, text: "답장하기" },
            action_id: "reply_sms",
            value: params.phoneNumber,
            style: "primary" as const,
          },
        ],
      },
    ],
  };
}
