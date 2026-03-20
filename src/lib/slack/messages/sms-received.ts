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
    ? `*${senderName}* (${formattedPhone})`
    : formattedPhone;

  // 상황별 안내 문구
  let greeting: string;
  if (isNewThread && lastAgentUserId) {
    greeting = isRegistered
      ? `<@${lastAgentUserId}> 님! ${contactDisplay} 님으로부터 새로운 문의가 들어왔어요. 확인해보세요!`
      : `<@${lastAgentUserId}> 님! ${formattedPhone} 번호에서 새로운 문의가 들어왔어요.`;
  } else if (isNewThread) {
    greeting = isRegistered
      ? `📩 ${contactDisplay} 님으로부터 새로운 문의가 도착했어요! 확인해보세요.`
      : `📩 ⚠️ 미등록 번호 (${formattedPhone})에서 새로운 문의가 도착했어요!`;
  } else if (lastAgentUserId) {
    greeting = isRegistered
      ? `<@${lastAgentUserId}> 님! ${senderName} 님이 답장을 보냈어요.`
      : `<@${lastAgentUserId}> 님! ${formattedPhone} 번호에서 답장이 왔어요.`;
  } else {
    greeting = isRegistered
      ? `${senderName} 님이 답장을 보냈어요.`
      : `${formattedPhone} 번호에서 답장이 왔어요.`;
  }

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

  const blocks: any[] = [
    { type: "section", text: { type: "mrkdwn", text: greeting } },
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

  const fallbackText = isNewThread
    ? `📩 ${senderName ?? formattedPhone} 님으로부터 새로운 문의`
    : `📩 ${senderName ?? formattedPhone} 님이 답장을 보냈어요`;

  return {
    text: fallbackText,
    attachments: [{ color, blocks }],
  };
}
