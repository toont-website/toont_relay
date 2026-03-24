import { getCsToolClient } from "@/lib/cs-tool/client";
import { logger } from "@/lib/logger";

/**
 * /contact-type 커맨드 핸들러
 * - /contact-type → 타입 목록
 * - /contact-type 추가 [이름] [slug] → 타입 추가
 * - /contact-type 삭제 [이름] → 타입 삭제
 */
export async function handleContactTypeCommand(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return listContactTypes();
  }

  if (trimmed.startsWith("추가 ")) {
    const rest = trimmed.slice(3).trim();
    const parts = rest.split(/\s+/);
    if (parts.length < 2) {
      return { text: "사용법: `/contact-type 추가 [이름] [slug]`\n예: `/contact-type 추가 원단업체 fabric`" };
    }
    const name = parts[0];
    const slug = parts[1];
    return createContactType(name, slug);
  }

  if (trimmed.startsWith("삭제 ")) {
    const name = trimmed.slice(3).trim();
    return deleteContactType(name);
  }

  return { text: "사용법:\n- `/contact-type` — 타입 목록\n- `/contact-type 추가 [이름] [slug]` — 타입 추가\n- `/contact-type 삭제 [이름]` — 타입 삭제" };
}

async function listContactTypes() {
  try {
    const res = await getCsToolClient().getContactTypes();
    const types = res.data ?? [];

    if (types.length === 0) {
      return { text: "등록된 연락처 타입이 없어요." };
    }

    const blocks: any[] = [
      { type: "header", text: { type: "plain_text", text: "연락처 타입 목록" } },
    ];

    for (const t of types) {
      const defaultLabel = t.isDefault ? " _(기본)_" : "";
      blocks.push({
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*${t.name}*${defaultLabel}` },
          { type: "mrkdwn", text: `\`${t.slug}\`` },
        ],
      });
    }

    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `총 ${types.length}개` }],
    });

    return { response_type: "ephemeral" as const, text: " ", blocks };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    return { text: `타입 목록 조회 실패: ${msg}` };
  }
}

async function createContactType(name: string, slug: string) {
  try {
    const res = await getCsToolClient().createContactType({ name, slug });
    const created = res.data;
    logger.info({ name, slug }, "연락처 타입 추가 (CS Tool)");
    return { text: `연락처 타입 추가: *${created?.name ?? name}* (\`${created?.slug ?? slug}\`)` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    if (msg.includes("409") || msg.toLowerCase().includes("conflict")) {
      return { text: `이미 존재하는 slug입니다: \`${slug}\`` };
    }
    logger.error({ error: msg, name, slug }, "연락처 타입 추가 실패");
    return { text: `타입 추가 실패: ${msg}` };
  }
}

async function deleteContactType(name: string) {
  try {
    const res = await getCsToolClient().getContactTypes();
    const types = res.data ?? [];
    const target = types.find((t) => t.name === name);

    if (!target) {
      return { text: `"${name}" 타입을 찾을 수 없어요.` };
    }

    await getCsToolClient().deleteContactType(target.id);
    logger.info({ name, id: target.id }, "연락처 타입 삭제 (CS Tool)");
    return { text: `연락처 타입 삭제: *${target.name}* (\`${target.slug}\`)` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    if (msg.includes("403") || msg.toLowerCase().includes("forbidden")) {
      return { text: `기본 타입은 삭제할 수 없어요: *${name}*` };
    }
    logger.error({ error: msg, name }, "연락처 타입 삭제 실패");
    return { text: `타입 삭제 실패: ${msg}` };
  }
}
