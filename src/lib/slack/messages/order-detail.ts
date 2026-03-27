import type { Order } from "@/lib/cs-tool/types";
import { formatPhoneNumber } from "@/lib/utils/phone";
import { getCsToolClient } from "@/lib/cs-tool/client";
import { getSlackClient } from "@/lib/slack/client";
import { logger } from "@/lib/logger";

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
        { type: "mrkdwn", text: `*📦 상품:* ${order.productNames ?? order.itemDescription ?? "-"} x${order.quantity}` },
      ],
    },
    ...(order.itemDescription && order.productNames ? [{
      type: "section",
      text: { type: "mrkdwn", text: `*📝 주문내용:* ${order.itemDescription}` },
    }] : []),
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

  // 액션 버튼 — 연락처 배정 + 체크리스트
  const topActions: any[] = [];

  const hasUnassigned = order.requiredContactTypes.some(
    (rt) => !order.contacts.find((c) => c.type === rt.slug)
  );
  if (hasUnassigned) {
    topActions.push({
      type: "button",
      text: { type: "plain_text", text: "연락처 배정" },
      action_id: "assign_order_contact",
      value: order.id,
    });
  }

  if (order.checklistStatus.some((cs) => !cs.complete)) {
    topActions.push({
      type: "button",
      text: { type: "plain_text", text: "체크리스트 작성" },
      action_id: "open_checklist",
      value: order.id,
    });
  }

  if (topActions.length > 0) {
    blocks.push({ type: "actions", elements: topActions });
  }

  // 메시지 템플릿 — 템플릿별 복사/보내기 버튼
  if (order.currentStageTemplates.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*━━ 메시지 템플릿 ━━*" },
    });
    for (let i = 0; i < order.currentStageTemplates.length; i++) {
      const t = order.currentStageTemplates[i];
      const text = `📨 ${t.contactTypeName} → ${t.label}\n> ${t.text}`;
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: text.slice(0, 3000) },
      });
      const val = JSON.stringify({ orderId: order.id, templateIndex: i });
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "📋 복사" },
            action_id: "copy_template",
            value: val,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "📨 보내기" },
            action_id: "send_template_sms",
            value: val,
            style: "primary",
          },
        ],
      });
    }
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

// ---------------------------------------------------------------------------
// 모달용 블록 빌더 — copy_template 버튼 제거 (response_url 불가)
// ---------------------------------------------------------------------------

function buildOrderDetailModalBlocks(order: Order): any[] {
  const phone = order.phone ? formatPhoneNumber(order.phone) : "-";
  const status = STATUS_MAP[order.status] ?? order.status;
  const statusIcon = order.status === "completed" ? "✅" : order.status === "cancelled" ? "❌" : "🔵";
  const dueDate = order.dueDate ?? "-";
  const productName = order.productNames ?? order.itemDescription ?? "-";
  const channel = order.orderId ?? "-";

  const blocks: any[] = [];

  // ── 주문 정보 ──
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `👤 *${order.customerName}*  ·  ${phone}\n🛒 구매경로: ${channel}`,
    },
  });

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `📦 *상품:* ${productName} x${order.quantity}`,
    },
  });

  if (order.itemDescription && order.productNames) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `📝 *주문내용:* ${order.itemDescription}` },
    });
  }

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `📍 *배송지:* ${order.address ?? "-"}\n📅 *납기일:* ${dueDate}  ·  ${statusIcon} *상태:* ${status}`,
    },
  });

  if (order.currentStageName) {
    const deadline = order.stageDeadline
      ? new Date(order.stageDeadline).toLocaleDateString("ko-KR")
      : "-";
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `🏷️ ${order.currentStageName} 단계 (${deadline}까지)  ·  진행률 ${order.progress ?? "-"}%  ·  프로필: ${order.profileName ?? "-"}` },
      ],
    });
  }

  // ── 메모 ──
  if (order.notes) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `📝 *메모*\n> ${order.notes.replace(/\n/g, "\n> ")}` },
    });
  }

  // ── 배정 연락처 ──
  if (order.requiredContactTypes.length > 0) {
    blocks.push({ type: "divider" });
    const contactLines = order.requiredContactTypes.map((rt) => {
      const assigned = order.contacts.find((c) => c.type === rt.slug);
      return assigned
        ? `✅ *${rt.name}:* ${assigned.name} (${assigned.phone ? formatPhoneNumber(assigned.phone) : "-"})`
        : `⬜ *${rt.name}:* 미배정`;
    });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*연락처*\n${contactLines.join("\n")}` },
    });
  }

  // ── 체크리스트 ──
  if (order.checklistStatus.length > 0) {
    blocks.push({ type: "divider" });
    for (const cs of order.checklistStatus) {
      const items = cs.items.map((item) => {
        if (item.type === "checkbox") {
          return item.checked ? `  ✅ ${item.label}` : `  ⬜ ${item.label}`;
        }
        return `  📝 ${item.label}: _${item.value ?? "-"}_`;
      });
      const text = `*체크리스트 — ${cs.stageName}*\n${items.join("\n")}`;
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: text.slice(0, 3000) },
      });
    }
  }

  // ── 액션 버튼 ──
  const topActions: any[] = [];

  const hasUnassigned = order.requiredContactTypes.some(
    (rt) => !order.contacts.find((c) => c.type === rt.slug),
  );
  if (hasUnassigned) {
    topActions.push({
      type: "button",
      text: { type: "plain_text", text: "연락처 배정" },
      action_id: "assign_order_contact",
      value: order.id,
    });
  }

  if (order.checklistStatus.some((cs) => !cs.complete)) {
    topActions.push({
      type: "button",
      text: { type: "plain_text", text: "체크리스트 작성" },
      action_id: "open_checklist",
      value: order.id,
    });
  }

  if (topActions.length > 0) {
    blocks.push({ type: "actions", elements: topActions });
  }

  // ── 메시지 템플릿 ──
  if (order.currentStageTemplates.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "*메시지 템플릿*" },
    });
    for (let i = 0; i < order.currentStageTemplates.length; i++) {
      const t = order.currentStageTemplates[i];
      const preview = t.text.length > 80 ? t.text.slice(0, 80) + "…" : t.text;
      const val = JSON.stringify({ orderId: order.id, templateIndex: i });
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `_${t.contactTypeName} > ${t.label}_\n> ${preview}`,
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "보내기" },
          action_id: "send_template_sms",
          value: val,
          style: "primary",
        },
      });
    }
  }

  // 모달 블록 100개 제한 방어
  if (blocks.length > 98) {
    blocks.length = 97;
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "_...일부 정보가 생략됐어요._" }],
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// 주문 상세 모달 오픈
// ---------------------------------------------------------------------------

export async function openOrderDetailModal(triggerId: string, orderId: string) {
  const client = getCsToolClient();
  const slackClient = getSlackClient();

  const result = await client.getOrder(orderId);
  if (!result.data) return;

  const order = result.data;
  const blocks = buildOrderDetailModalBlocks(order);
  const titleText = `주문 — ${order.orderId ?? order.customerName}`.slice(0, 24);

  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      title: { type: "plain_text", text: titleText },
      close: { type: "plain_text", text: "닫기" },
      blocks,
    },
  });
}
