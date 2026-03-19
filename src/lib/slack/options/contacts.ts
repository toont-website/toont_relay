import { prisma } from "@/lib/db/prisma";
import { formatPhoneNumber, normalizePhoneNumber } from "@/lib/utils/phone";
import { logger } from "@/lib/logger";

const DIRECT_INPUT_VALUE = "__direct_input__";

export { DIRECT_INPUT_VALUE };

export async function searchContacts(query: string) {
  if (!query.trim()) {
    return { options: [] };
  }

  let contacts: { id: string; name: string; phoneNumber: string; memo: string | null }[] = [];
  try {
    contacts = await prisma.contact.findMany({
      where: {
        OR: [
          { name: { contains: query } },
          { phoneNumber: { contains: query } },
        ],
      },
      take: 10,
      orderBy: { name: "asc" },
    });
    logger.debug({ query, count: contacts.length }, "연락처 검색");
  } catch (e) {
    logger.error({ error: e }, "연락처 검색 DB 에러");
    contacts = [];
  }

  const options = contacts.map((c) => ({
    text: { type: "plain_text" as const, text: `${c.name} (${formatPhoneNumber(c.phoneNumber)})` },
    value: c.phoneNumber,
  }));

  const normalized = normalizePhoneNumber(query);
  const directInputLabel = normalized
    ? `직접 입력: ${formatPhoneNumber(normalized)}`
    : `직접 입력: ${query}`;

  options.push({
    text: { type: "plain_text", text: directInputLabel },
    value: normalized ?? DIRECT_INPUT_VALUE,
  });

  return { options };
}
