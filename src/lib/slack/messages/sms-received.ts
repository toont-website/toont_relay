import { formatPhoneNumber } from "@/lib/utils/phone";

interface SmsReceivedMessageParams {
  senderName: string | null;
  phoneNumber: string;
  message: string;
  receivedAt: string;
  threadTs?: string;
  isNewThread: boolean;
  lastAgentUserId?: string;
}

export function buildSmsReceivedMessage(params: SmsReceivedMessageParams) {
  const { senderName, phoneNumber, message, receivedAt, threadTs, isNewThread, lastAgentUserId } = params;
  const formattedPhone = formatPhoneNumber(phoneNumber);

  const isRegistered = senderName !== null;
  const contactDisplay = isRegistered
    ? `${senderName} (${formattedPhone})`
    : formattedPhone;

  const headerText = isNewThread
    ? isRegistered
      ? `*📩 ${contactDisplay}*`
      : `*📩 ⚠️ 미등록 번호* (${formattedPhone})`
    : isRegistered
      ? `*📩 ${contactDisplay}*`
      : `*📩 ${formattedPhone}*`;

  const color = isRegistered ? "#36C759" : "#FFB800";

  const time = new Date(receivedAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const agentLine = lastAgentUserId ? `\n담당자: <@${lastAgentUserId}>` : "";

  const blocks: any[] = [
    { type: "section", text: { type: "mrkdwn", text: `${headerText}${agentLine}` } },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: message } },
    { type: "context", elements: [{ type: "mrkdwn", text: `📅 ${time}` }] },
  ];

  const actions: any[] = [
    {
      type: "button",
      text: { type: "plain_text", text: "답장하기" },
      action_id: "reply_sms",
      style: "primary",
      value: JSON.stringify({ phoneNumber, threadTs: threadTs ?? null }),
    },
  ];

  if (!isRegistered) {
    actions.push({
      type: "button",
      text: { type: "plain_text", text: "연락처 등록" },
      action_id: "register_contact",
      value: JSON.stringify({ phoneNumber }),
    });
  }

  blocks.push({ type: "actions", elements: actions });

  const fallbackLabel = isNewThread ? "새 문의" : "수신";

  return {
    text: `📩 ${fallbackLabel} — ${contactDisplay}`,
    attachments: [{ color, blocks }],
  };
}
