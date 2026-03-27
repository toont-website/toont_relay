import { type OperationBoard, type OperationStage, type Order, getOrderChannel } from "@/lib/cs-tool/types";
import { formatPhoneNumber } from "@/lib/utils/phone";

const STAGE_EMOJI: Record<string, string> = {
  blue: "🔵",
  orange: "🟠",
  green: "🟢",
  red: "🔴",
  purple: "🟣",
  yellow: "🟡",
};

function isDeadlineApproaching(deadline: string | null): boolean {
  if (!deadline) return false;
  const d = new Date(deadline);
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return d <= tomorrow;
}

/** 주문 한 줄 포맷 (칸반 요약용) */
function formatOrderLine(o: Order): string {
  const phone = o.phone ? formatPhoneNumber(o.phone) : "";
  const channel = getOrderChannel(o);
  const productName = o.productNames ?? o.itemDescription ?? "-";
  const deadline = o.stageDeadline
    ? new Date(o.stageDeadline).toLocaleDateString("ko-KR")
    : o.dueDate ?? "-";
  const warn = isDeadlineApproaching(o.stageDeadline) ? " ⚠️" : "";

  const lines = [
    `👤 *${o.customerName}*${phone ? ` (${phone})` : ""}`,
    `📦 ${channel ? `${channel} / ` : ""}${productName} x${o.quantity}`,
  ];
  if (o.itemDescription && o.productNames) {
    lines.push(`📝 ${o.itemDescription}`);
  }
  lines.push(`📅 마감: ${deadline}${warn}`);

  return lines.join("\n");
}

/** 주문 상세 카드 포맷 (단계 상세용) */
function formatOrderCard(order: Order): string {
  const phone = order.phone ? formatPhoneNumber(order.phone) : "";
  const channel = getOrderChannel(order);
  const productName = order.productNames ?? order.itemDescription ?? "-";
  const deadline = order.stageDeadline
    ? new Date(order.stageDeadline).toLocaleDateString("ko-KR")
    : order.dueDate ?? "-";
  const warn = isDeadlineApproaching(order.stageDeadline) ? " ⚠️ D-1" : "";

  const checklistInfo =
    order.checklistStatus.length > 0
      ? order.checklistStatus
          .map((cs) => {
            const done = cs.items.filter((i) =>
              i.type === "checkbox" ? i.checked : !!i.value
            ).length;
            return cs.complete ? "✓" : `${done}/${cs.items.length}`;
          })
          .join(", ")
      : "";

  const lines = [
    `👤 *${order.customerName}*${phone ? ` (${phone})` : ""}`,
    `📦 ${channel ? `${channel} / ` : ""}${productName} x${order.quantity}`,
  ];
  if (order.itemDescription && order.productNames) {
    lines.push(`📝 ${order.itemDescription}`);
  }
  lines.push(`📅 마감: ${deadline}${warn}${checklistInfo ? `  ·  체크: ${checklistInfo}` : ""}`);

  return lines.join("\n");
}

export function buildKanbanMessage(board: OperationBoard, unassignedOrders: Order[] = []) {
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: "🔄 오퍼레이션 현황" } },
    { type: "divider" },
  ];

  // 미배정 주문
  if (unassignedOrders.length > 0) {
    const lines = unassignedOrders.slice(0, 3).map(formatOrderLine);
    const more = unassignedOrders.length > 3 ? `\n_...외 ${unassignedOrders.length - 3}건_` : "";

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `⚪ *미배정* (${unassignedOrders.length}건)`,
      },
    });
    for (const line of lines) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: line },
      });
    }
    if (more) {
      blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: more }] });
    }
  }

  for (const stage of board.stages) {
    const emoji = STAGE_EMOJI[stage.color] ?? "⚪";

    if (stage.orders.length === 0) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `${emoji} *${stage.name}* (0건)` },
      });
      continue;
    }

    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `${emoji} *${stage.name}* (${stage.orders.length}건)` },
    });

    for (const o of stage.orders.slice(0, 3)) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: formatOrderLine(o) },
      });
    }

    if (stage.orders.length > 3) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `_...외 ${stage.orders.length - 3}건_` }],
      });
    }
  }

  // 상세 버튼 (미배정 + 단계별)
  const buttons: any[] = [];

  if (unassignedOrders.length > 0) {
    buttons.push({
      type: "button",
      text: { type: "plain_text", text: "미배정 상세" },
      action_id: "unassigned_detail",
      value: "unassigned",
    });
  }

  for (const s of board.stages) {
    buttons.push({
      type: "button",
      text: { type: "plain_text", text: `${s.name} 상세` },
      action_id: `stage_detail_${s.id}`,
      value: s.id,
    });
  }

  if (buttons.length > 0) {
    blocks.push({ type: "actions", elements: buttons.slice(0, 5) });
    // 5개 초과 시 두 번째 줄
    if (buttons.length > 5) {
      blocks.push({ type: "actions", elements: buttons.slice(5, 10) });
    }
  }

  // Slack 블록 50개 제한 방어
  if (blocks.length > 48) {
    blocks.length = 47;
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "_...일부 단계가 생략됐어요. `/operation [단계명]`으로 상세 조회하세요._" }],
    });
  }

  return { response_type: "ephemeral" as const, text: " ", blocks };
}

export function buildStageDetailMessage(stage: OperationStage, isLastStage = false) {
  const emoji = STAGE_EMOJI[stage.color] ?? "⚪";

  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} ${stage.name} 단계 상세` },
    },
    { type: "divider" },
  ];

  const displayOrders = stage.orders.slice(0, 15);

  for (const order of displayOrders) {
    blocks.push(
      {
        type: "section",
        text: { type: "mrkdwn", text: formatOrderCard(order) },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "주문 상세" },
            action_id: "view_order_detail",
            value: order.id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "체크리스트" },
            action_id: "open_checklist",
            value: order.id,
          },
          ...(isLastStage
            ? [{
                type: "button",
                text: { type: "plain_text", text: "완료하기" },
                action_id: "complete_order",
                value: order.id,
                style: "primary",
              }]
            : [{
                type: "button",
                text: { type: "plain_text", text: "다음 단계로" },
                action_id: "move_next_stage",
                value: order.id,
                style: "primary",
              }]),
        ],
      },
      { type: "divider" },
    );
  }

  if (stage.orders.length > 15) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `_...외 ${stage.orders.length - 15}건_` }],
    });
  }

  if (stage.orders.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_이 단계에 주문이 없어요._" },
    });
  }

  // Slack 블록 50개 제한 방어
  if (blocks.length > 48) {
    blocks.length = 47;
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "_...일부 주문이 생략됐어요._" }],
    });
  }

  return { response_type: "ephemeral" as const, text: " ", blocks };
}
