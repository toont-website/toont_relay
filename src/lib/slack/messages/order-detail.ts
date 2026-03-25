import type { Order } from "@/lib/cs-tool/types";
import { formatPhoneNumber } from "@/lib/utils/phone";

const STATUS_MAP: Record<string, string> = {
  pending: "대기",
  in_progress: "진행중",
  completed: "완료",
  cancelled: "취소",
};

export function buildOrderDetailMessage(order: Order) {
  const phone = order.phone ? formatPhoneNumber(order.phone) : "-";
  const status = STATUS_MAP[order.status] ?? order.status;
  const dueDate = order.dueDate ?? "-";

  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `📦 주문 상세 — ${order.orderId ?? order.id.slice(0, 8)}` },
    },
    { type: "divider" },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*👤 고객:* ${order.customerName} (${phone})` },
        { type: "mrkdwn", text: `*📦 상품:* ${order.itemDescription ?? "-"} x${order.quantity}` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*📍 배송지:* ${order.address ?? "-"}` },
        { type: "mrkdwn", text: `*📅 납기일:* ${dueDate}` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*🔄 상태:* ${status}` },
        { type: "mrkdwn", text: `*📋 프로필:* ${order.profileName ?? "-"}` },
      ],
    },
  ];

  // 현재 단계 + 진행률
  if (order.currentStageName) {
    const deadline = order.stageDeadline
      ? new Date(order.stageDeadline).toLocaleDateString("ko-KR")
      : "-";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `▸ *현재 단계:* ${order.currentStageName} (${deadline}까지)\n▸ *진행률:* ${order.progress ?? "-"}%`,
      },
    });
  }

  // 배정 연락처
  if (order.requiredContactTypes.length > 0) {
    blocks.push({ type: "divider" });
    const contactLines = order.requiredContactTypes.map((rt) => {
      const assigned = order.contacts.find((c) => c.type === rt.slug);
      return assigned
        ? `✅ ${rt.name}: ${assigned.name} (${assigned.phone ? formatPhoneNumber(assigned.phone) : "-"})`
        : `⚠️ ${rt.name}: 미배정`;
    });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*━━ 배정 연락처 ━━*\n${contactLines.join("\n")}` },
    });
  }

  // 체크리스트 — 단계별 개별 블럭 (3000자 제한 대응)
  if (order.checklistStatus.length > 0) {
    blocks.push({ type: "divider" });
    for (const cs of order.checklistStatus) {
      const items = cs.items.map((item) => {
        if (item.type === "checkbox") {
          return item.checked ? `☑️ ${item.label}` : `☐ ${item.label}`;
        }
        return `📝 ${item.label}: "${item.value ?? "-"}"`;
      });
      const text = `*━━ 체크리스트 (${cs.stageName}) ━━*\n${items.join("\n")}`;
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: text.slice(0, 3000) },
      });
    }
  }

  // 메시지 템플릿 — 템플릿별 개별 블럭 (3000자 제한 대응)
  if (order.currentStageTemplates.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*━━ 메시지 템플릿 ━━*" },
    });
    for (const t of order.currentStageTemplates) {
      const text = `📨 ${t.contactTypeName} → ${t.label}\n> ${t.text}`;
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: text.slice(0, 3000) },
      });
    }
  }

  // 액션 버튼
  const actions: any[] = [];

  const hasUnassigned = order.requiredContactTypes.some(
    (rt) => !order.contacts.find((c) => c.type === rt.slug)
  );
  if (hasUnassigned) {
    actions.push({
      type: "button",
      text: { type: "plain_text", text: "연락처 배정" },
      action_id: "assign_order_contact",
      value: order.id,
    });
  }

  if (order.checklistStatus.some((cs) => !cs.complete)) {
    actions.push({
      type: "button",
      text: { type: "plain_text", text: "체크리스트 작성" },
      action_id: "open_checklist",
      value: order.id,
    });
  }

  if (order.currentStageTemplates.length > 0) {
    actions.push(
      {
        type: "button",
        text: { type: "plain_text", text: "📋 복사" },
        action_id: "copy_template",
        value: order.id,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "📨 보내기" },
        action_id: "send_template_sms",
        value: order.id,
        style: "primary",
      },
    );
  }

  if (actions.length > 0) {
    blocks.push({ type: "actions", elements: actions });
  }

  // 메모
  if (order.notes) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `📝 메모: ${order.notes}` }],
    });
  }

  // 블럭 수 가드 — Slack 최대 50블럭
  if (blocks.length > 48) {
    blocks.length = 47;
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "_...일부 정보가 생략됐어요._" }],
    });
  }

  return { response_type: "ephemeral" as const, text: " ", blocks };
}
