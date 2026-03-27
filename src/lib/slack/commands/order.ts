import { getCsToolClient } from "@/lib/cs-tool/client";
import { getSlackClient } from "@/lib/slack/client";
import { normalizePhoneNumber } from "@/lib/utils/phone";
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

    if (orders.length === 0) {
      return { text: trimmed ? `"${trimmed}" 검색 결과가 없어요.` : "주문이 없어요." };
    }

    const total = result.meta?.total ?? orders.length;
    const title = trimmed ? `"${trimmed}" 검색 결과` : "최근 주문";

    const blocks: any[] = [
      { type: "header", text: { type: "plain_text", text: `📋 ${title} (${total}건)`.slice(0, 150) } },
    ];

    for (const order of orders) {
      const channel = order.orderId ?? "-";
      const productName = order.productNames ?? order.itemDescription ?? "-";
      const deadline = order.stageDeadline ?? order.dueDate ?? "-";

      blocks.push(
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📦 *${order.customerName}* - ${channel} / ${productName} x${order.quantity}\n   주문내용: ${order.itemDescription ?? "-"}\n   📅 마감: ${deadline}`,
          },
          accessory: {
            type: "button",
            text: { type: "plain_text", text: "상세" },
            action_id: "view_order_detail",
            value: order.id,
          },
        },
      );
    }

    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `<https://cs.toont.co.kr/?view=operations|📋 CS Tool에서 전체 주문 보기>` }],
    });

    return { response_type: "ephemeral" as const, text: " ", blocks };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ error: msg }, "주문 조회 실패");
    return { text: `주문 조회에 실패했어요.\n에러: ${msg}` };
  }
}

/**
 * /order-add → 모달 오픈 (상품 드롭다운 + 고객 정보 입력 + 프로필 연동)
 */
export async function handleOrderCreateCommand(triggerId: string) {
  const client = getCsToolClient();
  const slackClient = getSlackClient();

  try {
    // 재고 + 프로필 병렬 로드
    const [inventoryResult, profilesResult] = await Promise.all([
      client.getInventory(),
      client.getProfiles(),
    ]);
    const items = inventoryResult.data ?? [];
    const profiles = profilesResult.data ?? [];

    const productOptions = items.map((item) => ({
      text: {
        type: "plain_text" as const,
        text: `${item.name} (${item.sku}) — ${item.quantity}${item.unit} 남음`.slice(0, 75),
      },
      value: JSON.stringify({ name: item.name, sku: item.sku }),
    }));

    // 프로필 정보를 private_metadata에 저장 (block_actions에서 참조)
    // 크기 초과 시 단계적 축소 — Slack 3000바이트 제한 대응
    const profileMap = profiles.map((p) => ({
      id: p.id,
      name: p.name,
      skus: p.skus,
      contactTypeIds: p.contactTypeIds,
      isDefault: p.isDefault,
    }));

    let metadata: string;
    const fullMetadata = JSON.stringify({ profiles: profileMap });

    if (Buffer.byteLength(fullMetadata, "utf8") > 2900) {
      // 축소 1단계: contactTypeIds 제거
      const slimMetadata = JSON.stringify({
        profiles: profiles.map((p) => ({ id: p.id, name: p.name, skus: p.skus })),
        refetch: true,
      });
      if (Buffer.byteLength(slimMetadata, "utf8") > 2900) {
        // 축소 2단계: ID만 저장
        metadata = JSON.stringify({ profileIds: profiles.map((p) => p.id), refetch: true });
      } else {
        metadata = slimMetadata;
      }
    } else {
      metadata = fullMetadata;
    }

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

    // 상품 드롭다운 (상품이 있으면 멀티 셀렉트, 없으면 직접 입력 + 단일 수량)
    if (productOptions.length > 0) {
      blocks.push({
        type: "input",
        block_id: "product_block",
        dispatch_action: true,
        label: { type: "plain_text", text: "상품 (복수 선택 가능)" },
        element: {
          type: "multi_static_select",
          action_id: "product_select",
          placeholder: { type: "plain_text", text: "상품을 선택하세요" },
          options: productOptions.slice(0, 100), // Slack 최대 100개
        },
      });
      // SKU별 수량 필드는 상품 선택 후 동적으로 추가됨 (block_actions)
    } else {
      blocks.push(
        {
          type: "input",
          block_id: "product_block",
          label: { type: "plain_text", text: "상품명" },
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
          element: {
            type: "plain_text_input",
            action_id: "quantity_input",
            placeholder: { type: "plain_text", text: "2" },
          },
        },
      );
    }

    blocks.push(
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
      {
        type: "input",
        block_id: "notes_block",
        label: { type: "plain_text", text: "메모" },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "notes_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "특이사항, 요청사항 등" },
        },
      },
    );

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

/**
 * 상품 선택 시 SKU별 수량 필드 동적 추가 + 프로필 매칭 → 모달 갱신 (block_actions)
 */
export async function handleProductSelect(payload: any) {
  const slackClient = getSlackClient();
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
    .filter((p: { name: string; sku: string }) => p.sku);

  let profiles: Array<{
    id: string;
    name: string;
    skus: string[];
    isDefault: boolean;
    contactTypeIds: string[];
  }> = [];
  try {
    const meta = JSON.parse(view.private_metadata);
    if (meta.refetch || meta.profileIds) {
      // metadata가 축소된 경우 — API에서 재조회
      const result = await getCsToolClient().getProfiles();
      profiles = (result.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        skus: p.skus,
        contactTypeIds: p.contactTypeIds,
        isDefault: p.isDefault,
      }));
    } else {
      profiles = meta.profiles ?? [];
    }
  } catch { /* ignore */ }

  // 기존 블럭에서 수량/프로필/연락처 블럭 제거하고 재구성
  const baseBlocks = view.blocks.filter(
    (b: any) =>
      !b.block_id?.startsWith("qty_") &&
      !b.block_id?.startsWith("profile_") &&
      !b.block_id?.startsWith("order_contact_")
  );

  // product_block 뒤에 수량 + 프로필 블럭 삽입
  const productIdx = baseBlocks.findIndex((b: any) => b.block_id === "product_block");
  const insertIdx = productIdx >= 0 ? productIdx + 1 : baseBlocks.length;

  const newBlocks: any[] = [];

  // SKU별 수량 입력 필드 추가
  const existingValues = view.state?.values ?? {};
  for (const product of selectedProducts) {
    // 기존에 입력한 수량 보존
    const existingQty = existingValues[`qty_${product.sku}`]?.[`qty_input_${product.sku}`]?.value;
    newBlocks.push({
      type: "input",
      block_id: `qty_${product.sku}`,
      label: { type: "plain_text", text: `${product.name} (${product.sku}) 수량` },
      element: {
        type: "plain_text_input",
        action_id: `qty_input_${product.sku}`,
        placeholder: { type: "plain_text", text: "1" },
        ...(existingQty ? { initial_value: existingQty } : { initial_value: "1" }),
      },
    });
  }

  // 프로필 매칭 — 첫 번째 SKU 기준
  const primarySku = selectedProducts[0]?.sku;
  let selectedProfileId: string | undefined;

  if (primarySku) {
    const matched = profiles.filter((p) => p.skus.includes(primarySku));
    const defaultProfile = profiles.find((p) => p.isDefault);

    if (matched.length === 1) {
      selectedProfileId = matched[0].id;
      newBlocks.push({
        type: "section",
        block_id: "profile_auto",
        text: {
          type: "mrkdwn",
          text: `*프로필:* ${matched[0].name} (자동 선택)`,
        },
      });
    } else if (matched.length >= 2) {
      newBlocks.push({
        type: "input",
        block_id: "profile_select_block",
        dispatch_action: true,
        label: { type: "plain_text", text: "프로필" },
        element: {
          type: "static_select",
          action_id: "profile_select",
          placeholder: { type: "plain_text", text: "프로필을 선택하세요" },
          options: matched.map((p) => ({
            text: { type: "plain_text", text: p.name },
            value: p.id,
          })),
        },
      });
    } else if (defaultProfile) {
      selectedProfileId = defaultProfile.id;
      newBlocks.push({
        type: "section",
        block_id: "profile_auto",
        text: {
          type: "mrkdwn",
          text: `*프로필:* ${defaultProfile.name} (기본)`,
        },
      });
    }
  }

  // 프로필이 확정된 경우 연락처 external_select 추가
  if (selectedProfileId) {
    const profile = profiles.find((p) => p.id === selectedProfileId);
    if (profile && profile.contactTypeIds.length > 0) {
      const client = getCsToolClient();
      const typesResult = await client.getContactTypes();
      const allTypes = typesResult.data ?? [];

      for (const typeId of profile.contactTypeIds) {
        const ct = allTypes.find((t) => t.id === typeId);
        if (!ct) continue;
        newBlocks.push({
          type: "input",
          block_id: `order_contact_${ct.slug}`,
          label: { type: "plain_text", text: `${ct.name} 연락처` },
          optional: true,
          element: {
            type: "external_select",
            action_id: `contact_select_${ct.slug}`,
            placeholder: { type: "plain_text", text: `${ct.name} 검색...` },
            min_query_length: 1,
          },
        });
      }
    }
  }

  // 메타데이터에 선택된 profileId + selectedSkus 저장
  let updatedMeta: any = {};
  try {
    updatedMeta = JSON.parse(view.private_metadata);
  } catch { /* ignore */ }
  updatedMeta.selectedProfileId = selectedProfileId;
  updatedMeta.selectedProducts = selectedProducts;

  let metadataStr = JSON.stringify(updatedMeta);
  if (Buffer.byteLength(metadataStr, "utf8") > 2900) {
    delete updatedMeta.profiles;
    updatedMeta.refetch = true;
    metadataStr = JSON.stringify(updatedMeta);
  }

  const finalBlocks = [
    ...baseBlocks.slice(0, insertIdx),
    ...newBlocks,
    ...baseBlocks.slice(insertIdx),
  ];

  await slackClient.views.update({
    view_id: view.id,
    hash: view.hash,
    view: {
      type: "modal",
      callback_id: "order_add_modal",
      private_metadata: metadataStr,
      title: { type: "plain_text", text: "주문 등록" },
      submit: { type: "plain_text", text: "등록" },
      close: { type: "plain_text", text: "취소" },
      blocks: finalBlocks,
    },
  });
}

/**
 * 프로필 드롭다운 선택 시 연락처 external_select 동적 추가
 */
export async function handleProfileSelect(payload: any) {
  const slackClient = getSlackClient();
  const view = payload.view;
  const profileId = payload.actions[0]?.selected_option?.value;
  if (!profileId) return;

  let profiles: Array<{
    id: string;
    name: string;
    skus: string[];
    isDefault: boolean;
    contactTypeIds: string[];
  }> = [];
  try {
    const meta = JSON.parse(view.private_metadata);
    if (meta.refetch || meta.profileIds) {
      const result = await getCsToolClient().getProfiles();
      profiles = (result.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        skus: p.skus,
        contactTypeIds: p.contactTypeIds,
        isDefault: p.isDefault,
      }));
    } else {
      profiles = meta.profiles ?? [];
    }
  } catch { /* ignore */ }

  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return;

  // 기존 연락처 블럭 제거
  const baseBlocks = view.blocks.filter(
    (b: any) => !b.block_id?.startsWith("order_contact_")
  );

  const newContactBlocks: any[] = [];
  if (profile.contactTypeIds.length > 0) {
    const client = getCsToolClient();
    const typesResult = await client.getContactTypes();
    const allTypes = typesResult.data ?? [];

    for (const typeId of profile.contactTypeIds) {
      const ct = allTypes.find((t) => t.id === typeId);
      if (!ct) continue;
      newContactBlocks.push({
        type: "input",
        block_id: `order_contact_${ct.slug}`,
        label: { type: "plain_text", text: `${ct.name} 연락처` },
        optional: true,
        element: {
          type: "external_select",
          action_id: `contact_select_${ct.slug}`,
          placeholder: { type: "plain_text", text: `${ct.name} 검색...` },
          min_query_length: 1,
        },
      });
    }
  }

  // profile_select_block 뒤에 삽입
  const profileIdx = baseBlocks.findIndex((b: any) => b.block_id === "profile_select_block");
  const insertIdx = profileIdx >= 0 ? profileIdx + 1 : baseBlocks.length;

  let updatedMeta: any = {};
  try {
    updatedMeta = JSON.parse(view.private_metadata);
  } catch { /* ignore */ }
  updatedMeta.selectedProfileId = profileId;

  const finalBlocks = [
    ...baseBlocks.slice(0, insertIdx),
    ...newContactBlocks,
    ...baseBlocks.slice(insertIdx),
  ];

  await slackClient.views.update({
    view_id: view.id,
    hash: view.hash,
    view: {
      type: "modal",
      callback_id: "order_add_modal",
      private_metadata: JSON.stringify(updatedMeta),
      title: { type: "plain_text", text: "주문 등록" },
      submit: { type: "plain_text", text: "등록" },
      close: { type: "plain_text", text: "취소" },
      blocks: finalBlocks,
    },
  });
}

/**
 * order_add_modal view_submission — 검증만 (동기, 3초 내 응답)
 */
export interface ValidatedOrderAdd {
  customerName: string;
  phone: string;
  itemDescription: string;
  quantity: number;
  sku?: string;
  skus: string[];
  skuQuantities: Record<string, number>;
  address?: string;
  dueDate?: string;
  notes?: string;
  profileId?: string;
  contactIds: string[];
}

export async function validateOrderAdd(
  payload: any
): Promise<ValidatedOrderAdd | { response_action: "errors"; errors: Record<string, string> }> {
  const view = payload.view;
  const values = view.state.values;

  const customerName = values.customer_block.customer_input.value;
  const rawPhone = values.phone_block.phone_input.value;
  const address = values.address_block?.address_input?.value ?? undefined;
  const dueDate = values.due_date_block?.due_date_input?.selected_date ?? undefined;
  const notes = values.notes_block?.notes_input?.value ?? undefined;

  // 상품 — 멀티 셀렉트 또는 직접 입력
  let itemDescription: string;
  let sku: string | undefined;
  let skus: string[] = [];
  let skuQuantities: Record<string, number> = {};
  let quantity: number;

  const selectedProducts: any[] = values.product_block?.product_select?.selected_options ?? [];
  const manualProduct = values.product_block?.product_input?.value;

  if (selectedProducts.length > 0) {
    // 멀티 셀렉트: SKU별 수량 추출
    const names: string[] = [];
    const errors: Record<string, string> = {};

    for (const opt of selectedProducts) {
      let parsed;
      try {
        parsed = JSON.parse(opt.value);
      } catch {
        continue; // skip malformed option
      }
      const productSku = parsed.sku as string;
      const productName = parsed.name as string;

      names.push(productName);
      skus.push(productSku);

      const rawQty = values[`qty_${productSku}`]?.[`qty_input_${productSku}`]?.value;
      const qty = parseInt(rawQty, 10);
      if (isNaN(qty) || qty <= 0) {
        errors[`qty_${productSku}`] = "1 이상의 숫자를 입력해주세요.";
      } else {
        skuQuantities = { ...skuQuantities, [productSku]: qty };
      }
    }

    if (Object.keys(errors).length > 0) {
      return { response_action: "errors" as const, errors };
    }

    sku = skus[0];
    itemDescription = names.join(", ");
    quantity = Object.values(skuQuantities).reduce((sum, q) => sum + q, 0);
  } else if (manualProduct) {
    // 직접 입력 모드 (재고 없을 때 폴백)
    itemDescription = manualProduct;
    const rawQty = values.quantity_block?.quantity_input?.value;
    quantity = parseInt(rawQty, 10);
    if (isNaN(quantity) || quantity <= 0) {
      return {
        response_action: "errors" as const,
        errors: { quantity_block: "1 이상의 숫자를 입력해주세요." },
      };
    }
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

  // 프로필 ID 추출 (metadata 또는 드롭다운)
  let profileId: string | undefined;
  try {
    const meta = JSON.parse(view.private_metadata ?? "{}");
    profileId = meta.selectedProfileId;
  } catch { /* ignore */ }

  const profileSelect = values.profile_select_block?.profile_select?.selected_option?.value;
  if (profileSelect) {
    profileId = profileSelect;
  }

  // 연락처 ID 추출 (order_contact_* 블럭)
  const contactIds: string[] = [];
  for (const [blockId, blockValue] of Object.entries(values)) {
    if (!blockId.startsWith("order_contact_")) continue;
    const actionValue = Object.values(blockValue as any)[0] as any;
    const selected = actionValue?.selected_option?.value;
    if (!selected) continue;
    try {
      const parsed = JSON.parse(selected);
      if (parsed.id && parsed.id !== "__direct_input__") {
        contactIds.push(parsed.id);
      }
    } catch { /* ignore */ }
  }

  return { customerName, phone, itemDescription, quantity, sku, skus, skuQuantities, address, dueDate, notes, profileId, contactIds };
}

/**
 * order_add_modal — 주문 생성 실행 (비동기, after()에서 호출)
 */
export async function executeOrderAdd(data: ValidatedOrderAdd): Promise<void> {
  const { customerName, phone, itemDescription, quantity, sku, skus, skuQuantities, address, dueDate, notes, profileId, contactIds } = data;

  try {
    const client = getCsToolClient();
    const result = await client.createOrder({
      customerName,
      itemDescription,
      quantity,
      phone,
      sku,
      skus: skus.length > 0 ? skus : sku ? [sku] : undefined,
      skuQuantities: Object.keys(skuQuantities).length > 0 ? skuQuantities : undefined,
      address,
      dueDate,
      notes,
      profileId,
      channel: "slack",
    });

    const inv = result.data?.inventory;
    if (inv?.warning) {
      logger.warn({ customerName, sku, warning: inv.warning }, "주문 등록 — 재고 경고");
    }

    // 연락처 배정
    const orderId = result.data?.order?.id;
    if (orderId && contactIds.length > 0) {
      for (const contactId of contactIds) {
        try {
          await client.assignOrderContact(orderId, contactId);
        } catch (assignError) {
          logger.warn({ orderId, contactId, error: assignError }, "주문 연락처 배정 실패");
        }
      }
    }

    logger.info({ customerName, itemDescription, quantity, skus, skuQuantities, profileId, contactCount: contactIds.length }, "주문 등록 완료");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    if (msg.includes("INVALID_PROFILE")) {
      logger.error({ profileId }, "유효하지 않은 프로필");
    }
    logger.error({ error: msg }, "주문 등록 실패");
  }
}
