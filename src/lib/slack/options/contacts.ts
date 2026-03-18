import { prisma } from "@/lib/db/prisma";
import { formatPhoneNumber, normalizePhoneNumber } from "@/lib/utils/phone";

const DIRECT_INPUT_VALUE = "__direct_input__";

export { DIRECT_INPUT_VALUE };

export async function searchContacts(query: string) {
  if (!query.trim()) {
    return { options: [] };
  }

  const contacts = await prisma.contact.findMany({
    where: {
      OR: [
        { name: { contains: query } },
        { phoneNumber: { contains: query } },
      ],
    },
    take: 10,
    orderBy: { name: "asc" },
  });

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
