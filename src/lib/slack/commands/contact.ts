import { getCsToolClient } from "@/lib/cs-tool/client";
import { getSlackClient } from "@/lib/slack/client";
import { formatPhoneNumber, normalizePhoneNumber } from "@/lib/utils/phone";
import { logger } from "@/lib/logger";
import type { CsContact, ContactType } from "@/lib/cs-tool/types";

/**
 * /contact 커맨드 핸들러
 * - /contact → 전체 연락처 목록 (타입별 그룹)
 * - /contact [검색어] → 검색
 * - /contact 추가 → 등록 모달 (trigger_id 필요, 커맨드 라우트에서 처리)
 * - /contact 삭제 [이름] → 검색 + 삭제
 * - /contact 수정 [이름] → 검색 + 수정 버튼
 */
export async function handleContactCommand(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return listContacts();
  }

  if (trimmed === "추가") {
    return { text: "연락처 추가는 모달로 처리됩니다. (trigger_id 필요)" };
  }

  if (trimmed.startsWith("삭제 ")) {
    const query = trimmed.slice(3).trim();
    return deleteContact(query);
  }

  if (trimmed.startsWith("수정 ")) {
    const query = trimmed.slice(3).trim();
    return editContactSearch(query);
  }

  return searchContacts(trimmed);
}

/**
 * 연락처 등록 모달 열기
 */
export async function openContactAddModal(triggerId: string, prefillPhone?: string) {
  const client = getSlackClient();
  const csClient = getCsToolClient();

  let typeOptions: { text: { type: "plain_text"; text: string }; value: string }[] = [];
  try {
    const res = await csClient.getContactTypes();
    typeOptions = (res.data ?? []).map((t) => ({
      text: { type: "plain_text" as const, text: t.name },
      value: t.id,
    }));
  } catch (e) {
    logger.error({ error: e }, "연락처 타입 조회 실패");
  }

  const blocks: any[] = [
    {
      type: "input",
      block_id: "name_block",
      label: { type: "plain_text", text: "이름" },
      element: { type: "plain_text_input", action_id: "name_input" },
    },
  ];

  if (typeOptions.length > 0) {
    blocks.push({
      type: "input",
      block_id: "type_block",
      label: { type: "plain_text", text: "분류" },
      optional: true,
      element: {
        type: "static_select",
        action_id: "type_input",
        placeholder: { type: "plain_text", text: "분류 선택..." },
        options: typeOptions,
      },
    });
  }

  blocks.push(
    {
      type: "input",
      block_id: "phone_block",
      label: { type: "plain_text", text: "전화번호" },
      optional: true,
      hint: { type: "plain_text", text: "010-xxxx-xxxx 형식으로 입력해주세요" },
      element: {
        type: "plain_text_input",
        action_id: "phone_input",
        ...(prefillPhone ? { initial_value: formatPhoneNumber(prefillPhone) } : {}),
      },
    },
    {
      type: "input",
      block_id: "address_block",
      label: { type: "plain_text", text: "주소" },
      optional: true,
      element: { type: "plain_text_input", action_id: "address_input" },
    },
    {
      type: "input",
      block_id: "memo_block",
      label: { type: "plain_text", text: "메모" },
      optional: true,
      element: { type: "plain_text_input", action_id: "memo_input" },
    },
  );

  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "contact_add_modal",
      private_metadata: JSON.stringify({ prefillPhone: prefillPhone ?? null }),
      title: { type: "plain_text", text: "연락처 등록" },
      submit: { type: "plain_text", text: "등록" },
      close: { type: "plain_text", text: "취소" },
      blocks,
    },
  });
}

/**
 * 연락처 등록 모달 제출 처리
 */
export async function handleContactAddSubmit(payload: any) {
  const values = payload.view.state.values;
  const name = values.name_block?.name_input?.value;
  const typeId = values.type_block?.type_input?.selected_option?.value ?? undefined;
  const phoneRaw = values.phone_block?.phone_input?.value ?? undefined;
  const address = values.address_block?.address_input?.value ?? undefined;
  const memo = values.memo_block?.memo_input?.value ?? undefined;

  if (!name) {
    return {
      response_action: "errors" as const,
      errors: { name_block: "이름을 입력하세요" },
    };
  }

  const phone = phoneRaw ? (normalizePhoneNumber(phoneRaw) ?? undefined) : undefined;
  if (phoneRaw && !phone) {
    return {
      response_action: "errors" as const,
      errors: { phone_block: "유효하지 않은 전화번호입니다" },
    };
  }

  try {
    await getCsToolClient().createContact({ name, typeId, phone, address, memo });
    logger.info({ name, phone }, "연락처 등록 완료 (CS Tool)");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ error: msg }, "연락처 등록 실패");
    return {
      response_action: "errors" as const,
      errors: { name_block: `등록 실패: ${msg}` },
    };
  }

  return {
    response_action: "update",
    view: {
      type: "modal",
      title: { type: "plain_text", text: "완료" },
      close: { type: "plain_text", text: "닫기" },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "연락처를 등록했어요." },
        },
      ],
    },
  };
}

/**
 * 연락처 수정 모달 열기
 */
export async function openContactEditModal(triggerId: string, contactId: string) {
  const client = getSlackClient();
  const csClient = getCsToolClient();

  let contact: CsContact;
  try {
    const res = await csClient.getContact(contactId);
    contact = res.data!;
  } catch (e) {
    logger.error({ error: e, contactId }, "연락처 조회 실패");
    return;
  }

  let typeOptions: { text: { type: "plain_text"; text: string }; value: string }[] = [];
  try {
    const res = await csClient.getContactTypes();
    typeOptions = (res.data ?? []).map((t) => ({
      text: { type: "plain_text" as const, text: t.name },
      value: t.id,
    }));
  } catch (e) {
    logger.error({ error: e }, "연락처 타입 조회 실패");
  }

  const blocks: any[] = [
    {
      type: "input",
      block_id: "name_block",
      label: { type: "plain_text", text: "이름" },
      element: {
        type: "plain_text_input",
        action_id: "name_input",
        initial_value: contact.name,
      },
    },
  ];

  if (typeOptions.length > 0) {
    const currentType = typeOptions.find((o) => o.value === contact.typeId);
    blocks.push({
      type: "input",
      block_id: "type_block",
      label: { type: "plain_text", text: "분류" },
      optional: true,
      element: {
        type: "static_select",
        action_id: "type_input",
        placeholder: { type: "plain_text", text: "분류 선택..." },
        options: typeOptions,
        ...(currentType ? { initial_option: currentType } : {}),
      },
    });
  }

  blocks.push(
    {
      type: "input",
      block_id: "phone_block",
      label: { type: "plain_text", text: "전화번호" },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "phone_input",
        ...(contact.phone ? { initial_value: formatPhoneNumber(contact.phone) } : {}),
      },
    },
    {
      type: "input",
      block_id: "address_block",
      label: { type: "plain_text", text: "주소" },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "address_input",
        ...(contact.address ? { initial_value: contact.address } : {}),
      },
    },
    {
      type: "input",
      block_id: "memo_block",
      label: { type: "plain_text", text: "메모" },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: "memo_input",
        ...(contact.memo ? { initial_value: contact.memo } : {}),
      },
    },
  );

  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "contact_edit_modal",
      private_metadata: JSON.stringify({ contactId }),
      title: { type: "plain_text", text: "연락처 수정" },
      submit: { type: "plain_text", text: "저장" },
      close: { type: "plain_text", text: "취소" },
      blocks,
    },
  });
}

/**
 * 연락처 수정 모달 제출 처리
 */
export async function handleContactEditSubmit(payload: any) {
  let metadata: any;
  try {
    metadata = JSON.parse(payload.view.private_metadata);
  } catch {
    logger.error("private_metadata 파싱 실패 (handleContactEditSubmit)");
    return null;
  }
  const { contactId } = metadata;
  const values = payload.view.state.values;
  const name = values.name_block?.name_input?.value ?? undefined;
  const typeId = values.type_block?.type_input?.selected_option?.value ?? undefined;
  const phoneRaw = values.phone_block?.phone_input?.value ?? undefined;
  const address = values.address_block?.address_input?.value ?? undefined;
  const memo = values.memo_block?.memo_input?.value ?? undefined;

  const phone = phoneRaw ? (normalizePhoneNumber(phoneRaw) ?? undefined) : undefined;
  if (phoneRaw && !phone) {
    return {
      response_action: "errors" as const,
      errors: { phone_block: "유효하지 않은 전화번호입니다" },
    };
  }

  try {
    await getCsToolClient().updateContact(contactId, { name, typeId, phone, address, memo });
    logger.info({ contactId, name }, "연락처 수정 완료 (CS Tool)");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ error: msg }, "연락처 수정 실패");
    return {
      response_action: "errors" as const,
      errors: { name_block: `수정 실패: ${msg}` },
    };
  }

  return {
    response_action: "update",
    view: {
      type: "modal",
      title: { type: "plain_text", text: "완료" },
      close: { type: "plain_text", text: "닫기" },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "연락처를 수정했어요." },
        },
      ],
    },
  };
}

// ── 내부 함수 ──

async function listContacts() {
  try {
    const res = await getCsToolClient().getContacts({ limit: "30" });
    const contacts = res.data ?? [];

    if (contacts.length === 0) {
      return { text: "등록된 연락처가 없어요." };
    }

    // 타입별 그룹핑
    const grouped = new Map<string, CsContact[]>();
    for (const c of contacts) {
      const key = c.typeName || "미분류";
      const list = grouped.get(key) ?? [];
      grouped.set(key, [...list, c]);
    }

    const blocks: any[] = [
      { type: "header", text: { type: "plain_text", text: "연락처 목록" } },
    ];

    for (const [typeName, members] of grouped) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*[${typeName}]*`,
        },
      });

      for (const c of members) {
        const phone = c.phone ? formatPhoneNumber(c.phone) : "-";
        const lines = [`*${c.name}* [${typeName}]`];
        lines.push(`📞 ${phone}`);
        if (c.address) lines.push(`📍 ${c.address}`);
        if (c.memo) lines.push(`📝 ${c.memo}`);
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: lines.join("\n") },
        });
      }
    }

    const total = res.meta?.total ?? contacts.length;

    // Slack 블록 50개 제한 방어
    if (blocks.length > 48) {
      const displayedCount = contacts.length;
      blocks.length = 47;
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `_...외 ${total - displayedCount}명은 검색으로 조회해주세요._` }],
      });
    }

    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `총 ${total}명` }],
    });

    return { response_type: "ephemeral" as const, text: " ", blocks };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    return { text: `연락처 목록 조회 실패: ${msg}` };
  }
}

async function searchContacts(query: string) {
  try {
    const res = await getCsToolClient().getContacts({ search: query, limit: "20" });
    const contacts = res.data ?? [];

    if (contacts.length === 0) {
      return { text: `"${query}" 검색 결과 없음.` };
    }

    const blocks: any[] = [
      { type: "header", text: { type: "plain_text", text: `"${query}" 검색 결과` } },
    ];

    for (const c of contacts) {
      const phone = c.phone ? formatPhoneNumber(c.phone) : "-";
      blocks.push({
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*${c.name}* (${c.typeName})` },
          { type: "mrkdwn", text: `${phone}${c.memo ? ` — ${c.memo}` : ""}` },
        ],
      });
    }

    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `${contacts.length}건` }],
    });

    return { response_type: "ephemeral" as const, text: " ", blocks };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    return { text: `연락처 검색 실패: ${msg}` };
  }
}

async function deleteContact(query: string) {
  try {
    const res = await getCsToolClient().getContacts({ search: query, limit: "10" });
    const contacts = res.data ?? [];

    if (contacts.length === 0) {
      return { text: `"${query}" 검색 결과 없음.` };
    }

    if (contacts.length > 1) {
      const list = contacts
        .map((c) => `- ${c.name} (${c.phone ? formatPhoneNumber(c.phone) : "-"})`)
        .join("\n");
      return {
        text: `"${query}" 이름의 연락처가 ${contacts.length}명 있어요. 정확한 이름으로 다시 입력해주세요!\n\n${list}`,
      };
    }

    const target = contacts[0];
    await getCsToolClient().deleteContact(target.id);
    const phone = target.phone ? formatPhoneNumber(target.phone) : "-";
    return { text: `연락처 삭제: ${target.name} (${phone})` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    return { text: `연락처 삭제 실패: ${msg}` };
  }
}

async function editContactSearch(query: string) {
  try {
    const res = await getCsToolClient().getContacts({ search: query, limit: "10" });
    const contacts = res.data ?? [];

    if (contacts.length === 0) {
      return { text: `"${query}" 검색 결과 없음.` };
    }

    const blocks: any[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*"${query}" 수정 대상 선택:*` },
      },
    ];

    for (const c of contacts) {
      const phone = c.phone ? formatPhoneNumber(c.phone) : "-";
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*${c.name}* (${c.typeName}) — ${phone}` },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "수정" },
          action_id: "edit_contact",
          value: c.id,
        },
      });
    }

    return { response_type: "ephemeral" as const, text: " ", blocks };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    return { text: `연락처 검색 실패: ${msg}` };
  }
}
