import type { OperationBoard, OperationStage } from "@/lib/cs-tool/types";

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

export function buildKanbanMessage(board: OperationBoard) {
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: "🔄 오퍼레이션 현황" } },
    { type: "divider" },
  ];

  for (const stage of board.stages) {
    const emoji = STAGE_EMOJI[stage.color] ?? "⚪";
    const lines = stage.orders.slice(0, 5).map((o) => {
      const deadline = o.stageDeadline
        ? new Date(o.stageDeadline).toLocaleDateString("ko-KR", {
            month: "2-digit",
            day: "2-digit",
          })
        : "";
      const warn = isDeadlineApproaching(o.stageDeadline) ? " ⚠️ D-1" : "";
      return `  • ${o.orderId ?? o.customerName} — ${o.customerName} / ${o.itemDescription ?? "-"} x${o.quantity}${deadline ? ` / ~${deadline}` : ""}${warn}`;
    });

    const more =
      stage.orders.length > 5
        ? `\n  _...외 ${stage.orders.length - 5}건_`
        : "";

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${stage.name}* (${stage.orders.length}건)\n${lines.join("\n")}${more}`,
      },
    });
  }

  // 단계별 상세 버튼
  const buttons = board.stages.map((s) => ({
    type: "button",
    text: { type: "plain_text", text: `${s.name} 상세` },
    action_id: `stage_detail_${s.id}`,
    value: s.id,
  }));

  if (buttons.length > 0) {
    blocks.push({ type: "actions", elements: buttons.slice(0, 5) });
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

export function buildStageDetailMessage(stage: OperationStage) {
  const emoji = STAGE_EMOJI[stage.color] ?? "⚪";

  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji} ${stage.name} 단계 상세` },
    },
    { type: "divider" },
  ];

  const displayOrders = stage.orders.slice(0, 20);

  for (const order of displayOrders) {
    const deadline = order.stageDeadline
      ? new Date(order.stageDeadline).toLocaleDateString("ko-KR")
      : "-";
    const warn = isDeadlineApproaching(order.stageDeadline) ? " ⚠️ D-1" : "";

    const checklistInfo =
      order.checklistStatus.length > 0
        ? order.checklistStatus
            .map((cs) => {
              const done = cs.items.filter((i) =>
                i.type === "checkbox" ? i.checked : !!i.value
              ).length;
              return cs.complete ? "✅ 완료" : `${done}/${cs.items.length} 완료`;
            })
            .join(", ")
        : "";

    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📦 *${order.orderId ?? order.customerName}* — ${order.customerName} / ${order.itemDescription ?? "-"} x${order.quantity}\n   📅 마감: ${deadline}${warn}${checklistInfo ? `\n   체크리스트: ${checklistInfo}` : ""}`,
        },
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
          {
            type: "button",
            text: { type: "plain_text", text: "다음 단계로" },
            action_id: "move_next_stage",
            value: order.id,
            style: "primary",
          },
        ],
      }
    );
  }

  if (stage.orders.length > 20) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `_...외 ${stage.orders.length - 20}건_` }],
    });
  }

  if (stage.orders.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_이 단계에 주문이 없어요._" },
    });
  }

  return { response_type: "ephemeral" as const, text: " ", blocks };
}
