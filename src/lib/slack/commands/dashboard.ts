import { getCsToolClient } from "@/lib/cs-tool/client";
import { logger } from "@/lib/logger";
import { displayPhoneNumber } from "@/lib/utils/phone";

/**
 * /dashboard — 운영 현황 대시보드
 * 재고 + 진행중 주문을 한눈에 보여줌
 */
export async function handleDashboardCommand() {
  const client = getCsToolClient();

  try {
    const [inventoryResult, ordersResult] = await Promise.all([
      client.getInventory(),
      client.getOrders({ limit: "50" }),
    ]);

    const items = inventoryResult.data ?? [];
    const orders = ordersResult.data ?? [];

    const blocks: any[] = [];

    // === 재고 현황 ===
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: "📦 재고 현황" },
    });

    if (items.length > 0) {
      // 재고를 section fields로 표시 (2열 레이아웃)
      for (const item of items) {
        const isLow = item.minQuantity != null && item.quantity <= item.minQuantity;
        const status = isLow ? "⚠️ 부족" : "✅ 정상";
        blocks.push({
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*${item.name}*\n\`${item.sku}\`` },
            { type: "mrkdwn", text: `*재고:* ${item.quantity}${item.unit} / 기준: ${item.minQuantity ?? 0}${item.unit}\n${status}` },
          ],
        });
      }
    } else {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "_등록된 재고가 없어요._" },
      });
    }

    blocks.push({ type: "divider" });

    // === 진행중 주문 ===
    blocks.push({
      type: "header",
      text: { type: "plain_text", text: "📋 진행중 주문" },
    });

    const activeOrders = orders.filter((o) => o.status !== "completed" && o.status !== "cancelled");

    if (activeOrders.length > 0) {
      const stageGroups: Record<string, typeof activeOrders> = {};
      for (const order of activeOrders) {
        const stage = order.currentStageName ?? order.status ?? "미지정";
        if (!stageGroups[stage]) stageGroups[stage] = [];
        stageGroups[stage].push(order);
      }

      for (const [stage, stageOrders] of Object.entries(stageGroups)) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `*${stage}* (${stageOrders.length}건)` },
        });
        for (const order of stageOrders) {
          const due = order.dueDate ? order.dueDate : "";
          const phone = order.phone ? displayPhoneNumber(order.phone) : "-";
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${order.customerName}*  ·  ${phone}\n>${order.itemDescription} x${order.quantity}`,
            },
          });
          if (due) {
            blocks.push({
              type: "context",
              elements: [
                { type: "mrkdwn", text: `📅 납기 ${due}` },
              ],
            });
          }
        }
      }
    } else {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: "_진행중인 주문이 없어요._" },
      });
    }

    // === 요약 ===
    blocks.push({ type: "divider" });

    const lowStockCount = items.filter((i) => i.minQuantity != null && i.quantity <= i.minQuantity).length;
    const summaryParts = [
      `📦 재고 ${items.length}종`,
      lowStockCount > 0 ? `⚠️ 부족 ${lowStockCount}종` : null,
      `📋 진행중 ${activeOrders.length}건`,
    ].filter(Boolean);

    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: summaryParts.join("  ·  ") },
      ],
    });

    return {
      response_type: "ephemeral",
      text: " ",
      blocks,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ error: msg }, "대시보드 조회 실패");
    return { text: `대시보드를 불러오는 데 실패했어요.\n에러: ${msg}` };
  }
}
