import { displayPhoneNumber } from "@/lib/utils/phone";

const validChannelIdPattern = /^C[A-Z0-9]+$/;

type OrderReminderPayload = {
  channelId?: unknown;
  reminderType?: string;
  label?: string;
  targetDate?: string;
  orderId?: string;
  order?: {
    id?: string;
    customerName?: string;
    phone?: string;
    address?: string;
    productName?: string;
    productNames?: string;
    itemDescription?: string;
    deliveryEstimatedTime?: string | null;
  };
};

type AlimtalkDailySummaryPayload = {
  channelId?: unknown;
  summaryDate?: string;
  totalSent?: number;
  logsUrl?: string;
  items?: Array<{
    operationCode?: string;
    operationName?: string;
    count?: number;
  }>;
};

export function resolveSlackChannelId(channelId: unknown, fallbackChannelId: string): string {
  return typeof channelId === "string" && validChannelIdPattern.test(channelId)
    ? channelId
    : fallbackChannelId;
}

export function buildOrderReminderSlackMessage(data: OrderReminderPayload, fallbackChannelId: string) {
  const order = data.order ?? {};
  const channel = resolveSlackChannelId(data.channelId, fallbackChannelId);
  const phone = order.phone ? displayPhoneNumber(order.phone) : "";
  const product = order.productName ?? order.productNames ?? order.itemDescription ?? "-";
  const title = getReminderTitle(data.reminderType, data.label);
  const lines = [
    `*${title}*`,
    "",
    `*고객:* ${order.customerName ?? "-"}`,
    `*상품:* ${product}`,
    `*예정일:* ${data.targetDate ?? "-"}`,
  ];

  if (phone) lines.push(`*전화번호:* ${phone}`);
  if (order.address) lines.push(`*주소:* ${order.address}`);
  if (data.reminderType === "delivery_due" || data.reminderType === "delivery_delay_due") {
    lines.push(`*도착예정시간:* ${order.deliveryEstimatedTime ?? "-"}`);
  }
  lines.push("", `<https://cs.toont.co.kr/?view=cards&orderId=${order.id ?? data.orderId}|CS TOONT에서 주문 보기>`);

  return {
    channel,
    text: `${title}: ${order.customerName ?? "주문"}`,
    attachments: [
      {
        color: data.reminderType === "delivery_delay_due" ? "#FF9500" : "#2196F3",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: lines.join("\n") },
          },
        ],
      },
    ],
  };
}

export function buildAlimtalkDailySummarySlackMessage(data: AlimtalkDailySummaryPayload, fallbackChannelId: string) {
  const channel = resolveSlackChannelId(data.channelId, fallbackChannelId);
  const items = Array.isArray(data.items) ? data.items : [];
  const lines = [
    `*전날 자동 알림톡 발송 요약*`,
    "",
    `*기준일:* ${data.summaryDate ?? "-"}`,
    `*총 발송:* ${Number(data.totalSent ?? 0)}건`,
    "",
    ...items.map((item) => `- ${item.operationCode} ${item.operationName}: ${Number(item.count ?? 0)}건`),
  ];

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n") },
    },
  ];
  if (typeof data.logsUrl === "string" && data.logsUrl.startsWith("https://")) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "발송 이력 보기" },
          url: data.logsUrl,
        },
      ],
    });
  }

  return {
    channel,
    text: `전날 자동 알림톡 발송 요약: ${Number(data.totalSent ?? 0)}건`,
    attachments: [
      {
        color: "#36C759",
        blocks,
      },
    ],
  };
}

function getReminderTitle(reminderType: string | undefined, label: string | undefined): string {
  if (reminderType === "film_due") return "필름예정일 D-3 리마인드";
  if (reminderType === "delivery_due") return "배송예정일 D-1 리마인드";
  if (reminderType === "delivery_delay_due") return "변경 배송예정일 D-1 리마인드";
  return `${label || "커스텀 일정"} D-1 리마인드`;
}
