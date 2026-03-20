import { getCsToolClient } from "@/lib/cs-tool/client";
import { getSlackClient } from "@/lib/slack/client";
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

      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `<https://cs.toont.co.kr/?view=inventory|📦 CS Tool에서 재고 관리하기>` }],
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

      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `<https://cs.toont.co.kr/?view=inventory|📦 CS Tool에서 재고 관리하기>` }],
      });

      return { response_type: "ephemeral", text: " ", blocks };
    }

    // SKU 조회 — 전체 목록에서 필터
    const result = await client.getInventory();
    const items = result.data ?? [];
    const item = items.find((i) => i.sku === trimmed || i.name.includes(trimmed));

    if (!item) return { text: `"${trimmed}" SKU를 찾을 수 없어요.` };

    const isLow = item.minQuantity != null && item.quantity <= item.minQuantity;
    const warning = isLow ? "\n⚠️ *기준치 이하입니다! 발주를 검토해주세요.*" : "";
    const blocks: any[] = [
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*📦 ${item.name}*\n\`${item.sku}\`` },
          { type: "mrkdwn", text: `*재고:* ${item.quantity}${item.unit}\n*기준:* ${item.minQuantity ?? 0}${item.unit}` },
        ],
      },
    ];
    if (warning) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: warning } });
    }
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `카테고리: ${item.category ?? "-"}  ·  <https://cs.toont.co.kr/?view=inventory|재고 관리하기>` }],
    });
    return { response_type: "ephemeral", text: " ", blocks };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ error: msg }, "재고 조회 실패");
    return { text: `재고 조회에 실패했어요.\n에러: ${msg}` };
  }
}

/**
 * /stock-in → 입고 모달
 */
export async function handleInboundCommand(triggerId: string) {
  const client = getCsToolClient();
  const slackClient = getSlackClient();

  try {
    const inventoryResult = await client.getInventory();
    const items = inventoryResult.data ?? [];

    const options = items.map((item) => ({
      text: { type: "plain_text" as const, text: `${item.name} (${item.sku}) — ${item.quantity}${item.unit}` },
      value: item.sku,
    }));

    await slackClient.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: "stock_in_modal",
        title: { type: "plain_text", text: "입고 처리" },
        submit: { type: "plain_text", text: "입고" },
        close: { type: "plain_text", text: "취소" },
        blocks: [
          {
            type: "input",
            block_id: "sku_block",
            label: { type: "plain_text", text: "품목" },
            element: options.length > 0
              ? { type: "static_select", action_id: "sku_select", placeholder: { type: "plain_text", text: "품목 선택" }, options: options.slice(0, 100) }
              : { type: "plain_text_input", action_id: "sku_input", placeholder: { type: "plain_text", text: "SKU 입력" } },
          },
          {
            type: "input",
            block_id: "quantity_block",
            label: { type: "plain_text", text: "수량" },
            element: { type: "plain_text_input", action_id: "quantity_input", placeholder: { type: "plain_text", text: "10" } },
          },
          {
            type: "input",
            block_id: "reason_block",
            label: { type: "plain_text", text: "사유" },
            optional: true,
            element: { type: "plain_text_input", action_id: "reason_input", placeholder: { type: "plain_text", text: "공장 입고" } },
          },
        ],
      },
    });
    return null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    return { text: `입고 모달을 여는 데 실패했어요.\n에러: ${msg}` };
  }
}

/**
 * /stock-out → 출고 모달
 */
export async function handleOutboundCommand(triggerId: string) {
  const client = getCsToolClient();
  const slackClient = getSlackClient();

  try {
    const inventoryResult = await client.getInventory();
    const items = inventoryResult.data ?? [];

    const options = items.map((item) => ({
      text: { type: "plain_text" as const, text: `${item.name} (${item.sku}) — ${item.quantity}${item.unit}` },
      value: item.sku,
    }));

    await slackClient.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: "stock_out_modal",
        title: { type: "plain_text", text: "출고 처리" },
        submit: { type: "plain_text", text: "출고" },
        close: { type: "plain_text", text: "취소" },
        blocks: [
          {
            type: "input",
            block_id: "sku_block",
            label: { type: "plain_text", text: "품목" },
            element: options.length > 0
              ? { type: "static_select", action_id: "sku_select", placeholder: { type: "plain_text", text: "품목 선택" }, options: options.slice(0, 100) }
              : { type: "plain_text_input", action_id: "sku_input", placeholder: { type: "plain_text", text: "SKU 입력" } },
          },
          {
            type: "input",
            block_id: "quantity_block",
            label: { type: "plain_text", text: "수량" },
            element: { type: "plain_text_input", action_id: "quantity_input", placeholder: { type: "plain_text", text: "2" } },
          },
          {
            type: "input",
            block_id: "reason_block",
            label: { type: "plain_text", text: "사유" },
            optional: true,
            element: { type: "plain_text_input", action_id: "reason_input", placeholder: { type: "plain_text", text: "고객 배송" } },
          },
        ],
      },
    });
    return null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    return { text: `출고 모달을 여는 데 실패했어요.\n에러: ${msg}` };
  }
}

/**
 * stock_in_modal / stock_out_modal submission 처리
 */
export async function handleStockSubmission(payload: any, direction: "inbound" | "outbound") {
  const values = payload.view.state.values;

  const sku = values.sku_block?.sku_select?.selected_option?.value
    ?? values.sku_block?.sku_input?.value;
  const quantity = parseInt(values.quantity_block.quantity_input.value, 10);
  const reason = values.reason_block?.reason_input?.value ?? undefined;

  if (!sku) {
    return { response_action: "errors" as const, errors: { sku_block: "품목을 선택해주세요." } };
  }
  if (isNaN(quantity) || quantity <= 0) {
    return { response_action: "errors" as const, errors: { quantity_block: "1 이상의 숫자를 입력해주세요." } };
  }

  try {
    const client = getCsToolClient();
    const result = direction === "inbound"
      ? await client.inbound({ sku, quantity, reason })
      : await client.outbound({ sku, quantity, reason });

    const label = direction === "inbound" ? "입고" : "출고";
    logger.info({ sku, quantity, direction }, `${label} 완료`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    return { response_action: "errors" as const, errors: { sku_block: `${direction === "inbound" ? "입고" : "출고"} 실패: ${msg}` } };
  }

  return null;
}
