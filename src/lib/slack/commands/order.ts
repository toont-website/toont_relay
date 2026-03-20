import { getCsToolClient } from "@/lib/cs-tool/client";
import { getSlackClient } from "@/lib/slack/client";
import { formatPhoneNumber, normalizePhoneNumber } from "@/lib/utils/phone";
import { logger } from "@/lib/logger";

/**
 * /order [검색어]
 * - /order → 최근 주문 목록
 * - /order 홍길동 → 고객명 검색
 * - /order 접수 → 상태 필터
 */
export async function handleOrderCommand(text: string) {
  const trimmed = text.trim();
  const client = getCsToolClient();

  try {
    const filters: Record<string, string> = { limit: "10" };
    if (trimmed) {
      const statusMap: Record<string, string> = {
        접수: "received",
        제작: "production",
        배송중: "shipping",
        완료: "completed",
        취소: "cancelled",
      };
      if (statusMap[trimmed]) {
        filters.status = statusMap[trimmed];
      } else {
        filters.customer = trimmed;
      }
    }

    const result = await client.getOrders(filters);
    const orders = result.data ?? [];

    if (orders.length === 0) {
      return { text: trimmed ? `"${trimmed}" 검색 결과가 없어요.` : "주문이 없어요." };
    }

    const list = orders
      .map((order) => {
        const phone = order.phone ? ` (${formatPhoneNumber(order.phone)})` : "";
        const stage = order.currentStageName ? ` · ${order.currentStageName}` : "";
        const date = new Date(order.createdAt).toLocaleDateString("ko-KR");
        return `• *${order.customerName}*${phone} — ${order.itemDescription} x${order.quantity}${stage} _(${date})_`;
      })
      .join("\n");

    const total = result.meta?.total ?? orders.length;
    const title = trimmed ? `"${trimmed}" 검색 결과` : "최근 주문";

    return { text: `*📋 ${title}* (${total}건)\n\n${list}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ error: msg }, "주문 조회 실패");
    return { text: `주문 조회에 실패했어요.\n에러: ${msg}` };
  }
}

/**
 * /order-add → 모달 오픈 (상품 드롭다운 + 고객 정보 입력)
 */
export async function handleOrderCreateCommand(triggerId: string) {
  const client = getCsToolClient();
  const slackClient = getSlackClient();

  try {
    // 재고(상품) 목록 가져오기
    const inventoryResult = await client.getInventory();
    const items = inventoryResult.data ?? [];

    const productOptions = items.map((item) => ({
      text: {
        type: "plain_text" as const,
        text: `${item.name} (${item.sku}) — ${item.quantity}${item.unit} 남음`,
      },
      value: JSON.stringify({ name: item.name, sku: item.sku }),
    }));

    const blocks: any[] = [
      {
        type: "input",
        block_id: "customer_block",
        label: { type: "plain_text", text: "고객명" },
        element: {
          type: "plain_text_input",
          action_id: "customer_input",
          placeholder: { type: "plain_text", text: "홍길동" },
        },
      },
      {
        type: "input",
        block_id: "phone_block",
        label: { type: "plain_text", text: "전화번호" },
        element: {
          type: "plain_text_input",
          action_id: "phone_input",
          placeholder: { type: "plain_text", text: "010-1234-5678" },
        },
      },
    ];

    // 상품 드롭다운 (상품이 있으면 드롭다운, 없으면 직접 입력)
    if (productOptions.length > 0) {
      blocks.push({
        type: "input",
        block_id: "product_block",
        label: { type: "plain_text", text: "상품" },
        element: {
          type: "static_select",
          action_id: "product_select",
          placeholder: { type: "plain_text", text: "상품을 선택하세요" },
          options: productOptions.slice(0, 100), // Slack 최대 100개
        },
      });
    } else {
      blocks.push({
        type: "input",
        block_id: "product_block",
        label: { type: "plain_text", text: "상품명" },
        element: {
          type: "plain_text_input",
          action_id: "product_input",
          placeholder: { type: "plain_text", text: "직선형 120cm - 포슬린" },
        },
      });
    }

    blocks.push(
      {
        type: "input",
        block_id: "quantity_block",
        label: { type: "plain_text", text: "수량" },
        element: {
          type: "plain_text_input",
          action_id: "quantity_input",
          placeholder: { type: "plain_text", text: "2" },
        },
      },
      {
        type: "input",
        block_id: "address_block",
        label: { type: "plain_text", text: "배송지" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "address_input",
          placeholder: { type: "plain_text", text: "서울시 강남구..." },
        },
      },
      {
        type: "input",
        block_id: "due_date_block",
        label: { type: "plain_text", text: "납기일" },
        optional: true,
        element: {
          type: "datepicker",
          action_id: "due_date_input",
          placeholder: { type: "plain_text", text: "날짜 선택" },
        },
      },
    );

    await slackClient.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: "order_add_modal",
        title: { type: "plain_text", text: "주문 등록" },
        submit: { type: "plain_text", text: "등록" },
        close: { type: "plain_text", text: "취소" },
        blocks,
      },
    });

    return null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ error: msg }, "주문 등록 모달 오픈 실패");
    return { text: `주문 등록 모달을 여는 데 실패했어요.\n에러: ${msg}` };
  }
}

/**
 * order_add_modal view_submission 처리
 */
export async function handleOrderAddSubmission(payload: any) {
  const view = payload.view;
  const values = view.state.values;

  const customerName = values.customer_block.customer_input.value;
  const rawPhone = values.phone_block.phone_input.value;
  const quantity = parseInt(values.quantity_block.quantity_input.value, 10);
  const address = values.address_block?.address_input?.value ?? undefined;
  const dueDate = values.due_date_block?.due_date_input?.selected_date ?? undefined;

  // 상품 — 드롭다운 또는 직접 입력
  let itemDescription: string;
  const selectedProduct = values.product_block?.product_select?.selected_option;
  const manualProduct = values.product_block?.product_input?.value;

  if (selectedProduct) {
    const parsed = JSON.parse(selectedProduct.value);
    itemDescription = parsed.name;
  } else if (manualProduct) {
    itemDescription = manualProduct;
  } else {
    return {
      response_action: "errors" as const,
      errors: { product_block: "상품을 선택해주세요." },
    };
  }

  if (!customerName) {
    return {
      response_action: "errors" as const,
      errors: { customer_block: "고객명을 입력해주세요." },
    };
  }

  const phone = normalizePhoneNumber(rawPhone);
  if (!phone) {
    return {
      response_action: "errors" as const,
      errors: { phone_block: "유효한 전화번호를 입력해주세요." },
    };
  }

  if (isNaN(quantity) || quantity <= 0) {
    return {
      response_action: "errors" as const,
      errors: { quantity_block: "1 이상의 숫자를 입력해주세요." },
    };
  }

  try {
    const client = getCsToolClient();
    await client.createOrder({
      customerName,
      itemDescription,
      quantity,
      phone,
      address,
      dueDate,
      channel: "slack",
    });

    logger.info({ customerName, itemDescription, quantity }, "주문 등록 완료");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ error: msg }, "주문 등록 실패");
    return {
      response_action: "errors" as const,
      errors: { customer_block: `등록 실패: ${msg}` },
    };
  }

  return null;
}
