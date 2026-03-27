import { getCsToolClient } from "@/lib/cs-tool/client";
import { formatPhoneNumber, normalizePhoneNumber } from "@/lib/utils/phone";
import { logger } from "@/lib/logger";

const DIRECT_INPUT_VALUE = "__direct_input__";

export { DIRECT_INPUT_VALUE };

export async function searchContacts(query: string, contactType?: string) {
  let contacts: { id: string; name: string; phone: string; address: string | null }[] = [];
  try {
    const client = getCsToolClient();
    const res = await client.getContacts({
      ...(contactType ? { type: contactType } : {}),
      ...(query.trim() ? { search: query } : {}),
      limit: "10",
    });
    contacts = (res.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      address: c.address,
    }));
    logger.debug({ query, contactType, count: contacts.length }, "연락처 검색 (CS Tool)");
  } catch (e) {
    logger.error({ error: e }, "연락처 검색 CS Tool API 에러");
    contacts = [];
  }

  const options = contacts.map((c) => ({
    text: {
      type: "plain_text" as const,
      text: `${c.name} (${formatPhoneNumber(c.phone)})`,
    },
    value: JSON.stringify({ id: c.id, phone: c.phone, name: c.name, address: c.address }),
  }));

  if (query.trim()) {
    const normalized = normalizePhoneNumber(query);
    const directInputLabel = normalized
      ? `직접 입력: ${formatPhoneNumber(normalized)}`
      : `직접 입력: ${query}`;

    options.push({
      text: { type: "plain_text", text: directInputLabel },
      value: normalized ?? DIRECT_INPUT_VALUE,
    });
  }

  return { options };
}
