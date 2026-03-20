import { getCsToolClient } from "@/lib/cs-tool/client";
import { logger } from "@/lib/logger";

/**
 * /재고 [SKU] — 재고 조회
 * - /재고 → 전체 재고 현황
 * - /재고 부족 → 기준치 이하 재고만
 * - /재고 WA-120-POR → 특정 SKU 상세
 */
export async function handleInventoryCommand(text: string) {
  const trimmed = text.trim();
  const client = getCsToolClient();

  try {
    if (!trimmed) {
      const result = await client.getInventory();
      const items = result.data ?? [];
      if (items.length === 0) return { text: "등록된 재고가 없어요." };

      const blocks: any[] = [
        { type: "header", text: { type: "plain_text", text: "📦 재고 현황" } },
      ];

      for (const item of items) {
        const isLow = item.minQuantity != null && item.quantity <= item.minQuantity;
        const status = isLow ? "⚠️ 부족" : "✅";
        blocks.push({
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*${item.name}*\n\`${item.sku}\`` },
            { type: "mrkdwn", text: `재고: *${item.quantity}${item.unit}* / 기준: ${item.minQuantity ?? 0}${item.unit} ${status}` },
          ],
        });
      }

      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `총 ${items.length}종` }],
      });

      return { response_type: "ephemeral", text: " ", blocks };
    }

    if (trimmed === "부족") {
      const result = await client.getInventory({ low_stock: "true" });
      const items = result.data ?? [];
      if (items.length === 0) return { text: "✅ 기준치 이하 재고가 없어요!" };

      const blocks: any[] = [
        { type: "header", text: { type: "plain_text", text: "⚠️ 재고 부족 항목" } },
      ];

      for (const item of items) {
        blocks.push({
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*${item.name}*\n\`${item.sku}\`` },
            { type: "mrkdwn", text: `재고: *${item.quantity}${item.unit}* / 기준: ${item.minQuantity}${item.unit}` },
          ],
        });
      }

      return { response_type: "ephemeral", text: " ", blocks };
    }

    // SKU 조회
    const result = await client.getInventoryBySku(trimmed);
    const item = result.data;
    if (!item) return { text: `"${trimmed}" SKU를 찾을 수 없어요.` };

    const warning = item.minQuantity && item.quantity <= item.minQuantity ? "\n⚠️ *기준치 이하입니다!*" : "";
    return {
      text: `*📦 ${item.name}*\nSKU: ${item.sku}\n수량: ${item.quantity}${item.unit}\n최소 기준: ${item.minQuantity ?? "-"}${item.unit}${warning}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ error: msg }, "재고 조회 실패");
    return { text: `재고 조회에 실패했어요.\n에러: ${msg}` };
  }
}

/**
 * /입고 [SKU] [수량] [사유]
 * 예: /입고 WA-120-POR 10 공장 입고
 */
export async function handleInboundCommand(text: string, userId: string) {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) {
    return { text: "사용법: `/입고 [SKU] [수량] [사유]`\n예: `/입고 WA-120-POR 10 공장 입고`" };
  }

  const sku = parts[0];
  const quantity = parseInt(parts[1], 10);
  if (isNaN(quantity) || quantity <= 0) {
    return { text: "수량은 1 이상의 숫자로 입력해주세요." };
  }
  const reason = parts.slice(2).join(" ") || undefined;

  try {
    const client = getCsToolClient();
    const result = await client.inbound({ sku, quantity, reason });
    const item = result.data;
    return {
      text: `✅ 입고 완료!\n*${item?.name ?? sku}* — +${quantity}${item?.unit ?? "개"}\n현재 재고: ${item?.quantity ?? "?"}${item?.unit ?? "개"}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    return { text: `입고 처리에 실패했어요.\n에러: ${msg}` };
  }
}

/**
 * /출고 [SKU] [수량] [사유]
 * 예: /출고 WA-120-POR 2 고객 배송
 */
export async function handleOutboundCommand(text: string, userId: string) {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) {
    return { text: "사용법: `/출고 [SKU] [수량] [사유]`\n예: `/출고 WA-120-POR 2 고객 배송`" };
  }

  const sku = parts[0];
  const quantity = parseInt(parts[1], 10);
  if (isNaN(quantity) || quantity <= 0) {
    return { text: "수량은 1 이상의 숫자로 입력해주세요." };
  }
  const reason = parts.slice(2).join(" ") || undefined;

  try {
    const client = getCsToolClient();
    const result = await client.outbound({ sku, quantity, reason });
    const item = result.data;
    const warning =
      item?.minQuantity && item.quantity <= item.minQuantity ? "\n⚠️ *기준치 이하! 발주를 검토해주세요.*" : "";
    return {
      text: `✅ 출고 완료!\n*${item?.name ?? sku}* — -${quantity}${item?.unit ?? "개"}\n현재 재고: ${item?.quantity ?? "?"}${item?.unit ?? "개"}${warning}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    return { text: `출고 처리에 실패했어요.\n에러: ${msg}` };
  }
}
