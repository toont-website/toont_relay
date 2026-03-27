import { getCsToolClient } from "@/lib/cs-tool/client";
import { getSlackClient } from "@/lib/slack/client";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// private_metadata 헬퍼
// ---------------------------------------------------------------------------

interface OrderMetadata {
  customerContactId?: string;
  customerName?: string;
  customerPhone?: string;
  freightContactId?: string;
  selectedProfileId?: string;
  selectedProducts?: Array<{ name: string; sku: string }>;
  freightRequired?: boolean;
  refetch?: boolean;
  profiles?: Array<{
    id: string;
    name: string;
    skus: string[];
    contactTypeIds: string[];
    isDefault: boolean;
  }>;
}

function parseMetadata(raw: string | undefined): OrderMetadata {
  try {
    return JSON.parse(raw ?? "{}");
  } catch {
    return {};
  }
}

function serializeMetadata(meta: OrderMetadata): string {
  let str = JSON.stringify(meta);
  if (Buffer.byteLength(str, "utf8") > 2900) {
    const slimmed = { ...meta, profiles: undefined, refetch: true };
    str = JSON.stringify(slimmed);
  }
  if (Buffer.byteLength(str, "utf8") > 2900) {
    // 극단적 축소 — 최소한의 ID만
    const minimal: OrderMetadata = {
      customerContactId: meta.customerContactId,
      customerName: meta.customerName,
      customerPhone: meta.customerPhone,
      freightContactId: meta.freightContactId,
      selectedProfileId: meta.selectedProfileId,
      freightRequired: meta.freightRequired,
      refetch: true,
    };
    str = JSON.stringify(minimal);
  }
  return str;
}

// ---------------------------------------------------------------------------
// views.update 래퍼 (hash 불일치 시 warn만)
// ---------------------------------------------------------------------------

async function safeViewsUpdate(
  viewId: string,
  hash: string | undefined,
  metadata: string,
  blocks: any[],
): Promise<void> {
  const slackClient = getSlackClient();
  try {
    await slackClient.views.update({
      view_id: viewId,
      ...(hash ? { hash } : {}),
      view: {
        type: "modal",
        callback_id: "order_add_modal",
        private_metadata: metadata,
        title: { type: "plain_text", text: "주문 등록" },
        submit: { type: "plain_text", text: "등록" },
        close: { type: "plain_text", text: "취소" },
        blocks,
      },
    });
  } catch (error: any) {
    const msg = error?.data?.error ?? error?.message ?? "";
    if (msg.includes("hash") || msg.includes("expired_trigger_id")) {
      logger.warn({ viewId, error: msg }, "views.update hash 불일치 — 무시");
    } else {
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// 기존 값 보존 헬퍼
// ---------------------------------------------------------------------------

function preserveTextValue(
  values: any,
  blockId: string,
  actionId: string,
): string | undefined {
  return values?.[blockId]?.[actionId]?.value ?? undefined;
}

function preserveDateValue(
  values: any,
  blockId: string,
  actionId: string,
): string | undefined {
  return values?.[blockId]?.[actionId]?.selected_date ?? undefined;
}

// ---------------------------------------------------------------------------
// /order [검색어]
// ---------------------------------------------------------------------------

const PAGE_SIZE = 5;

export async function handleOrderCommand(text: string, page: number = 1) {
  const trimmed = text.trim();
  const client = getCsToolClient();

  try {
    const filters: Record<string, string> = {
      limit: String(PAGE_SIZE),
      page: String(page),
    };
    if (trimmed) {
      const statusMap: Record<string, string> = {
        대기: "pending",
        "진행중": "in_progress",
        진행: "in_progress",
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

    if (orders.length === 0 && page === 1) {
      return { text: trimmed ? `"${trimmed}" 검색 결과가 없어요.` : "주문이 없어요." };
    }

    const total = result.meta?.total ?? orders.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const title = trimmed ? `"${trimmed}" 검색 결과` : "최근 주문";

    const from = (page - 1) * PAGE_SIZE + 1;
    const to = Math.min(page * PAGE_SIZE, total);
    const rangeLabel = from === to ? `${from}/${total}` : `${from}~${to}/${total}`;

    const blocks: any[] = [
      { type: "header", text: { type: "plain_text", text: `📋 ${title} (${rangeLabel})`.slice(0, 150) } },
    ];

    for (const order of orders) {
      const channel = order.orderId || undefined;
      const productName = order.productNames ?? order.itemDescription ?? "-";
      const deadline = order.stageDeadline ?? order.dueDate ?? "-";
      const stageName = order.currentStageName
        ?? (order.status === "completed" ? "완료" : order.status === "cancelled" ? "취소" : "미배정");
      const status = order.status === "completed" ? "✅" : order.status === "cancelled" ? "❌" : "🔵";

      blocks.push({ type: "divider" });
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${status} *${order.customerName}*${channel ? `  ·  ${channel}` : ""}\n📦 ${productName} x${order.quantity}${order.itemDescription ? `\n📝 ${order.itemDescription}` : ""}\n🏷️ ${stageName}  ·  📅 ${deadline}`,
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "상세" },
          action_id: "view_order_detail",
          value: order.id,
        },
      });
    }

    // 페이지 네비게이션 버튼
    const navButtons: any[] = [];
    if (page > 1) {
      navButtons.push({
        type: "button",
        text: { type: "plain_text", text: "◀ 이전" },
        action_id: "order_page_prev",
        value: JSON.stringify({ page: page - 1, search: trimmed }),
      });
    }
    if (total > page * PAGE_SIZE) {
      navButtons.push({
        type: "button",
        text: { type: "plain_text", text: "다음 ▶" },
        action_id: "order_page_next",
        value: JSON.stringify({ page: page + 1, search: trimmed }),
      });
    }
    if (navButtons.length > 0) {
      blocks.push({ type: "actions", elements: navButtons });
    }

    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `페이지 ${page}/${totalPages} (총 ${total}건)  ·  <https://cs.toont.co.kr/?view=operations|CS Tool에서 전체 보기>` },
      ],
    });

    return { response_type: "ephemeral" as const, text: " ", blocks };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ error: msg }, "주문 조회 실패");
    return { text: `주문 조회에 실패했어요.\n에러: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// /order-add (또는 /order 추가) → 모달 오픈
// ---------------------------------------------------------------------------

export async function handleOrderCreateCommand(triggerId: string) {
  const client = getCsToolClient();
  const slackClient = getSlackClient();

  try {
    const inventoryResult = await client.getInventory();
    const items = inventoryResult.data ?? [];

    const productOptions = items.map((item) => ({
      text: {
        type: "plain_text" as const,
        text: `${item.name} (${item.sku}) — ${item.quantity}${item.unit} 남음`.slice(0, 75),
      },
      value: JSON.stringify({ name: item.name, sku: item.sku }),
    }));

    const blocks: any[] = [
      // 1. 주문자 (external_select, 필수)
      {
        type: "input",
        block_id: "customer_block",
        label: { type: "plain_text", text: "주문자" },
        element: {
          type: "external_select",
          action_id: "customer_contact_select",
          placeholder: { type: "plain_text", text: "고객 검색..." },
          min_query_length: 0,
        },
        dispatch_action: true,
      },
      // 2. 화물/배차 (external_select, 선택)
      {
        type: "input",
        block_id: "freight_block",
        label: { type: "plain_text", text: "화물/배차" },
        optional: true,
        element: {
          type: "external_select",
          action_id: "freight_contact_select",
          placeholder: { type: "plain_text", text: "화물/배차 검색..." },
          min_query_length: 0,
        },
      },
      // 3. 구매경로
      {
        type: "input",
        block_id: "channel_block",
        label: { type: "plain_text", text: "구매경로" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "channel_input",
          placeholder: { type: "plain_text", text: "자사몰, 네이버 등" },
        },
      },
    ];

    // 4. 상품 (multi_static_select)
    if (productOptions.length > 0) {
      blocks.push({
        type: "input",
        block_id: "product_block",
        label: { type: "plain_text", text: "상품" },
        optional: true,
        hint: { type: "plain_text", text: "상품 선택 후 수량 입력칸이 나타날 때까지 잠시 기다려주세요" },
        element: {
          type: "multi_static_select",
          action_id: "product_select",
          placeholder: { type: "plain_text", text: "상품 선택 (복수 가능)" },
          options: productOptions.slice(0, 100),
        },
        dispatch_action: true,
      });
    } else {
      blocks.push(
        {
          type: "input",
          block_id: "product_block",
          label: { type: "plain_text", text: "상품명" },
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: "product_input",
            placeholder: { type: "plain_text", text: "직선형 120cm - 포슬린" },
          },
        },
        {
          type: "input",
          block_id: "quantity_block",
          label: { type: "plain_text", text: "수량" },
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: "quantity_input",
            placeholder: { type: "plain_text", text: "2" },
          },
        },
      );
    }

    blocks.push(
      // 5. 주문내용
      {
        type: "input",
        block_id: "description_block",
        label: { type: "plain_text", text: "주문내용" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "description_input",
          multiline: true,
        },
      },
      // 6. 수령지 주소
      {
        type: "input",
        block_id: "address_block",
        label: { type: "plain_text", text: "수령지 주소" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "address_input",
        },
      },
      // 7. 완료예정일
      {
        type: "input",
        block_id: "due_block",
        label: { type: "plain_text", text: "완료예정일" },
        optional: true,
        element: { type: "datepicker", action_id: "due_picker" },
      },
      // 8. 발송예정일
      {
        type: "input",
        block_id: "ship_block",
        label: { type: "plain_text", text: "발송예정일" },
        optional: true,
        element: { type: "datepicker", action_id: "ship_picker" },
      },
      // 9. 진행률
      {
        type: "input",
        block_id: "progress_block",
        label: { type: "plain_text", text: "진행률" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "progress_input",
          placeholder: { type: "plain_text", text: "0~100" },
        },
      },
      // 10. 메모
      {
        type: "input",
        block_id: "notes_block",
        label: { type: "plain_text", text: "메모" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "notes_input",
          multiline: true,
        },
      },
    );

    const metadata = serializeMetadata({});

    await slackClient.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: "order_add_modal",
        private_metadata: metadata,
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

// ---------------------------------------------------------------------------
// 상품 선택 → SKU별 수량 + 프로필 매칭 (block_actions)
// ---------------------------------------------------------------------------

export async function handleProductSelect(payload: any) {
  const view = payload.view;
  const selectedOptions: any[] = payload.actions[0]?.selected_options ?? [];

  // 선택된 SKU 목록 파싱
  const selectedProducts = selectedOptions
    .map((opt: any) => {
      try {
        const parsed = JSON.parse(opt.value);
        return { name: parsed.name as string, sku: parsed.sku as string };
      } catch {
        return { name: opt.text?.text ?? "unknown", sku: "" };
      }
    })
    .filter((p) => p.sku);

  const selectedSkus = selectedProducts.map((p) => p.sku);

  // 프로필 매칭 — profiles/match API 사용
  let matchedProfiles: Array<{
    id: string;
    name: string;
    skus: string[];
    contactTypeIds: string[];
    isDefault: boolean;
  }> = [];

  if (selectedSkus.length > 0) {
    try {
      const client = getCsToolClient();
      const matchResult = await client.getProfilesBySkus(selectedSkus);
      const profiles = matchResult.data?.profiles ?? [];
      matchedProfiles = profiles.map((p) => ({
        id: p.id,
        name: p.name,
        skus: p.skus,
        contactTypeIds: p.contactTypeIds,
        isDefault: p.isDefault,
      }));
    } catch (error) {
      logger.warn({ error, skus: selectedSkus }, "프로필 매칭 API 실패 — 프로필 없이 진행");
    }
  }

  // 기존 블럭에서 동적 블럭 제거하고 재구성
  const baseBlocks = view.blocks.filter(
    (b: any) =>
      !b.block_id?.startsWith("qty_") &&
      !b.block_id?.startsWith("profile_"),
  );

  const productIdx = baseBlocks.findIndex((b: any) => b.block_id === "product_block");
  const insertIdx = productIdx >= 0 ? productIdx + 1 : baseBlocks.length;

  const newBlocks: any[] = [];
  const existingValues = view.state?.values ?? {};

  // SKU별 수량 입력 필드
  for (const product of selectedProducts) {
    const existingQty = existingValues[`qty_${product.sku}`]?.[`qty_input_${product.sku}`]?.value;
    newBlocks.push({
      type: "input",
      block_id: `qty_${product.sku}`,
      label: { type: "plain_text", text: `${product.name} (${product.sku}) 수량` },
      element: {
        type: "plain_text_input",
        action_id: `qty_input_${product.sku}`,
        placeholder: { type: "plain_text", text: "1" },
        initial_value: existingQty ?? "1",
      },
    });
  }

  // 프로필 매칭 결과
  let selectedProfileId: string | undefined;
  let freightRequired = false;

  if (matchedProfiles.length === 1) {
    selectedProfileId = matchedProfiles[0].id;
    newBlocks.push({
      type: "section",
      block_id: "profile_auto",
      text: {
        type: "mrkdwn",
        text: `*프로필:* ${matchedProfiles[0].name} (자동 선택)`,
      },
    });
    // 화물 필수 여부 판단
    if (matchedProfiles[0].contactTypeIds.length > 0) {
      freightRequired = true;
    }
  } else if (matchedProfiles.length >= 2) {
    newBlocks.push({
      type: "input",
      block_id: "profile_select_block",
      dispatch_action: true,
      label: { type: "plain_text", text: "프로필" },
      element: {
        type: "static_select",
        action_id: "profile_select",
        placeholder: { type: "plain_text", text: "프로필을 선택하세요" },
        options: matchedProfiles.map((p) => ({
          text: { type: "plain_text", text: p.name },
          value: p.id,
        })),
      },
    });
  }
  // 0개면 프로필 블록 없음

  // 메타데이터 업데이트
  const meta = parseMetadata(view.private_metadata);
  const updatedMeta: OrderMetadata = {
    ...meta,
    selectedProfileId,
    selectedProducts,
    freightRequired,
  };

  // 화물 필수 시 freight_block의 optional 변경 반영
  const finalBaseBlocks = baseBlocks.map((b: any) => {
    if (b.block_id === "freight_block") {
      return { ...b, optional: !freightRequired };
    }
    return b;
  });

  // 기존 텍스트 필드 값 보존
  const preservedBlocks = finalBaseBlocks.map((b: any) => {
    const blockId = b.block_id;
    if (!blockId || blockId === "product_block") return b;

    // 텍스트 인풋 보존
    if (b.element?.type === "plain_text_input") {
      const actionId = b.element.action_id;
      const val = preserveTextValue(existingValues, blockId, actionId);
      if (val) {
        return {
          ...b,
          element: { ...b.element, initial_value: val },
        };
      }
    }

    // datepicker 보존
    if (b.element?.type === "datepicker") {
      const actionId = b.element.action_id;
      const val = preserveDateValue(existingValues, blockId, actionId);
      if (val) {
        return {
          ...b,
          element: { ...b.element, initial_date: val },
        };
      }
    }

    return b;
  });

  const finalBlocks = [
    ...preservedBlocks.slice(0, insertIdx),
    ...newBlocks,
    ...preservedBlocks.slice(insertIdx),
  ];

  await safeViewsUpdate(
    view.id,
    view.hash,
    serializeMetadata(updatedMeta),
    finalBlocks,
  );
}

// ---------------------------------------------------------------------------
// 프로필 드롭다운 선택 (block_actions)
// ---------------------------------------------------------------------------

export async function handleProfileSelect(payload: any) {
  const view = payload.view;
  const profileId = payload.actions[0]?.selected_option?.value;
  if (!profileId) return;

  const meta = parseMetadata(view.private_metadata);

  // 프로필 정보 가져오기 — API에서 직접 조회
  let freightRequired = false;
  let profileName = "";
  try {
    const client = getCsToolClient();
    const result = await client.getProfile(profileId);
    const profile = result.data;
    if (profile) {
      profileName = profile.name;
      freightRequired = profile.contactTypeIds.length > 0;
    }
  } catch (error) {
    logger.warn({ error, profileId }, "프로필 조회 실패");
  }

  const updatedMeta: OrderMetadata = {
    ...meta,
    selectedProfileId: profileId,
    freightRequired,
  };

  // 화물 필수 시 freight_block optional 변경
  const updatedBlocks = view.blocks.map((b: any) => {
    if (b.block_id === "freight_block") {
      return { ...b, optional: !freightRequired };
    }
    return b;
  });

  await safeViewsUpdate(
    view.id,
    view.hash,
    serializeMetadata(updatedMeta),
    updatedBlocks,
  );
}

// ---------------------------------------------------------------------------
// 주문자(고객) 선택 (block_actions)
// ---------------------------------------------------------------------------

export async function handleCustomerContactSelect(payload: any) {
  const view = payload.view;
  const selectedValue = payload.actions[0]?.selected_option?.value;
  if (!selectedValue) return;

  let contactData: { id?: string; name?: string; phone?: string; address?: string | null };
  try {
    contactData = JSON.parse(selectedValue);
  } catch {
    logger.warn({ selectedValue }, "주문자 선택 값 파싱 실패");
    return;
  }

  const meta = parseMetadata(view.private_metadata);
  const updatedMeta: OrderMetadata = {
    ...meta,
    customerContactId: contactData.id,
    customerName: contactData.name,
    customerPhone: contactData.phone,
  };

  // 주소 자동 채움 — address_block에 initial_value 설정
  const existingValues = view.state?.values ?? {};

  const updatedBlocks = view.blocks.map((b: any) => {
    if (b.block_id === "address_block" && contactData.address) {
      return {
        ...b,
        element: {
          ...b.element,
          initial_value: contactData.address,
        },
      };
    }

    // 다른 텍스트 필드 값 보존
    const blockId = b.block_id;
    if (!blockId) return b;

    if (b.element?.type === "plain_text_input" && blockId !== "address_block") {
      const actionId = b.element.action_id;
      const val = preserveTextValue(existingValues, blockId, actionId);
      if (val) {
        return {
          ...b,
          element: { ...b.element, initial_value: val },
        };
      }
    }

    if (b.element?.type === "datepicker") {
      const actionId = b.element.action_id;
      const val = preserveDateValue(existingValues, blockId, actionId);
      if (val) {
        return {
          ...b,
          element: { ...b.element, initial_date: val },
        };
      }
    }

    return b;
  });

  await safeViewsUpdate(
    view.id,
    view.hash,
    serializeMetadata(updatedMeta),
    updatedBlocks,
  );
}

// ---------------------------------------------------------------------------
// 화물/배차 선택 (block_actions)
// ---------------------------------------------------------------------------

export async function handleFreightContactSelect(payload: any) {
  const view = payload.view;
  const selectedValue = payload.actions[0]?.selected_option?.value;
  if (!selectedValue) return;

  let contactData: { id?: string };
  try {
    contactData = JSON.parse(selectedValue);
  } catch {
    logger.warn({ selectedValue }, "화물 선택 값 파싱 실패");
    return;
  }

  const meta = parseMetadata(view.private_metadata);
  const updatedMeta: OrderMetadata = {
    ...meta,
    freightContactId: contactData.id,
  };

  // 기존 필드 값 보존
  const existingValues = view.state?.values ?? {};
  const updatedBlocks = view.blocks.map((b: any) => {
    const blockId = b.block_id;
    if (!blockId) return b;

    if (b.element?.type === "plain_text_input") {
      const actionId = b.element.action_id;
      const val = preserveTextValue(existingValues, blockId, actionId);
      if (val) {
        return {
          ...b,
          element: { ...b.element, initial_value: val },
        };
      }
    }

    if (b.element?.type === "datepicker") {
      const actionId = b.element.action_id;
      const val = preserveDateValue(existingValues, blockId, actionId);
      if (val) {
        return {
          ...b,
          element: { ...b.element, initial_date: val },
        };
      }
    }

    return b;
  });

  await safeViewsUpdate(
    view.id,
    view.hash,
    serializeMetadata(updatedMeta),
    updatedBlocks,
  );
}

// ---------------------------------------------------------------------------
// validateOrderAdd — 제출 검증
// ---------------------------------------------------------------------------

export interface ValidatedOrderAdd {
  customerName: string;
  phone: string;
  address?: string;
  channel?: string;
  skus: string[];
  skuQuantities: Record<string, number>;
  itemDescription?: string;
  quantity: number;
  dueDate?: string;
  shipDate?: string;
  progress?: string;
  notes?: string;
  profileId?: string;
  customerContactId?: string;
  freightContactId?: string;
}

export async function validateOrderAdd(
  payload: any,
): Promise<ValidatedOrderAdd | { response_action: "errors"; errors: Record<string, string> }> {
  const view = payload.view;
  const values = view.state.values;
  const meta = parseMetadata(view.private_metadata);

  // 주문자 (필수) — external_select
  const customerOption = values.customer_block?.customer_contact_select?.selected_option;
  if (!customerOption) {
    return {
      response_action: "errors" as const,
      errors: { customer_block: "주문자를 선택해주세요." },
    };
  }

  let customerName: string;
  let phone: string;
  let customerContactId: string | undefined;
  try {
    const parsed = JSON.parse(customerOption.value);
    customerName = parsed.name;
    phone = parsed.phone;
    customerContactId = parsed.id;
  } catch {
    return {
      response_action: "errors" as const,
      errors: { customer_block: "주문자 정보를 읽을 수 없습니다." },
    };
  }

  if (!customerName || !phone) {
    return {
      response_action: "errors" as const,
      errors: { customer_block: "주문자 이름/전화번호가 올바르지 않습니다." },
    };
  }

  // 화물/배차 (선택 또는 필수)
  let freightContactId: string | undefined;
  const freightOption = values.freight_block?.freight_contact_select?.selected_option;
  if (freightOption) {
    try {
      const parsed = JSON.parse(freightOption.value);
      freightContactId = parsed.id;
    } catch { /* ignore */ }
  }

  // metadata에서 freightRequired 체크
  if (meta.freightRequired && !freightContactId) {
    return {
      response_action: "errors" as const,
      errors: { freight_block: "프로필에서 화물/배차가 필수입니다. 선택해주세요." },
    };
  }

  // 구매경로
  const channel = values.channel_block?.channel_input?.value ?? undefined;

  // 상품
  const selectedProducts: any[] = values.product_block?.product_select?.selected_options ?? [];
  const manualProduct = values.product_block?.product_input?.value;

  let skus: string[] = [];
  let skuQuantities: Record<string, number> = {};
  let quantity = 0;

  if (selectedProducts.length > 0) {
    const errors: Record<string, string> = {};

    for (const opt of selectedProducts) {
      let parsed;
      try {
        parsed = JSON.parse(opt.value);
      } catch {
        continue;
      }
      const productSku = parsed.sku as string;

      skus.push(productSku);

      const rawQty = values[`qty_${productSku}`]?.[`qty_input_${productSku}`]?.value;
      const qty = rawQty ? parseInt(rawQty, 10) : 1;
      if (isNaN(qty) || qty <= 0) {
        errors[`qty_${productSku}`] = "1 이상의 숫자를 입력해주세요.";
      } else {
        skuQuantities = { ...skuQuantities, [productSku]: qty };
      }
    }

    if (Object.keys(errors).length > 0) {
      return { response_action: "errors" as const, errors };
    }

    quantity = Object.values(skuQuantities).reduce((sum, q) => sum + q, 0);
  } else if (manualProduct) {
    const rawQty = values.quantity_block?.quantity_input?.value;
    quantity = rawQty ? parseInt(rawQty, 10) : 1;
    if (isNaN(quantity) || quantity <= 0) {
      return {
        response_action: "errors" as const,
        errors: { quantity_block: "1 이상의 숫자를 입력해주세요." },
      };
    }
  }

  // 주문내용 (사용자 입력만, 상품명 합치지 않음)
  const itemDescription = values.description_block?.description_input?.value ?? (manualProduct || undefined);

  // 수령지 주소
  const address = values.address_block?.address_input?.value ?? undefined;

  // 완료예정일
  const dueDate = values.due_block?.due_picker?.selected_date ?? undefined;

  // 발송예정일
  const shipDate = values.ship_block?.ship_picker?.selected_date ?? undefined;

  // 진행률
  const progressRaw = values.progress_block?.progress_input?.value ?? undefined;
  let progress: string | undefined;
  if (progressRaw) {
    const num = parseInt(progressRaw, 10);
    if (isNaN(num) || num < 0 || num > 100) {
      return {
        response_action: "errors" as const,
        errors: { progress_block: "0~100 사이의 숫자를 입력해주세요." },
      };
    }
    progress = String(num);
  }

  // 메모
  const notes = values.notes_block?.notes_input?.value ?? undefined;

  // 프로필 ID — metadata 또는 드롭다운
  let profileId = meta.selectedProfileId;
  const profileSelect = values.profile_select_block?.profile_select?.selected_option?.value;
  if (profileSelect) {
    profileId = profileSelect;
  }

  return {
    customerName,
    phone,
    address,
    channel,
    skus,
    skuQuantities,
    itemDescription,
    quantity: quantity || 1,
    dueDate,
    shipDate,
    progress,
    notes,
    profileId,
    customerContactId,
    freightContactId,
  };
}

// ---------------------------------------------------------------------------
// executeOrderAdd — 주문 생성 실행 (after()에서 호출)
// ---------------------------------------------------------------------------

export async function executeOrderAdd(data: ValidatedOrderAdd): Promise<void> {
  try {
    const client = getCsToolClient();
    const result = await client.createOrder({
      customerName: data.customerName,
      phone: data.phone,
      itemDescription: data.itemDescription ?? "",
      quantity: data.quantity,
      address: data.address,
      channel: data.channel,
      skus: data.skus.length > 0 ? data.skus : undefined,
      skuQuantities: Object.keys(data.skuQuantities).length > 0 ? data.skuQuantities : undefined,
      dueDate: data.dueDate,
      shipDate: data.shipDate,
      progress: data.progress,
      notes: data.notes,
      profileId: data.profileId,
      customerContactId: data.customerContactId,
      freightContactId: data.freightContactId,
    });

    const inv = result.data?.inventory;
    if (inv?.warning) {
      logger.warn({ customerName: data.customerName, skus: data.skus, warning: inv.warning }, "주문 등록 — 재고 경고");
    }

    logger.info(
      {
        customerName: data.customerName,
        itemDescription: data.itemDescription,
        quantity: data.quantity,
        skus: data.skus,
        profileId: data.profileId,
        customerContactId: data.customerContactId,
        freightContactId: data.freightContactId,
      },
      "주문 등록 완료",
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    if (msg.includes("INVALID_PROFILE")) {
      logger.error({ profileId: data.profileId }, "유효하지 않은 프로필");
    }
    logger.error({ error: msg }, "주문 등록 실패");
  }
}
