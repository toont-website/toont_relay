import { prisma } from "@/lib/db/prisma";
import { normalizePhoneNumber, formatPhoneNumber } from "@/lib/utils/phone";

/**
 * /contact 커맨드 핸들러
 * - /contact → 전체 연락처 목록
 * - /contact 이름 010-1234-5678 → 추가
 * - /contact 이름 010-1234-5678 메모내용 → 메모 포함 추가
 * - /contact 삭제 이름 → 삭제
 */
export async function handleContactCommand(text: string) {
  const trimmed = text.trim();

  // 인자 없으면 목록
  if (!trimmed) {
    return listContacts();
  }

  // 삭제
  if (trimmed.startsWith("삭제 ")) {
    const name = trimmed.slice(3).trim();
    return deleteContact(name);
  }

  // 추가: 이름 번호 [메모]
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return { text: "사용법:\n• `/contact` — 연락처 목록\n• `/contact 이름 번호 [메모]` — 추가\n• `/contact 삭제 이름` — 삭제" };
  }

  const name = parts[0];
  const phoneInput = parts[1];
  const memo = parts.slice(2).join(" ") || null;

  const phoneNumber = normalizePhoneNumber(phoneInput);
  if (!phoneNumber) {
    return { text: `유효하지 않은 전화번호: ${phoneInput}` };
  }

  try {
    const contact = await prisma.contact.upsert({
      where: { phoneNumber },
      update: { name, memo },
      create: { name, phoneNumber, memo },
    });

    return {
      text: `연락처 저장: ${contact.name} (${formatPhoneNumber(contact.phoneNumber)})${memo ? ` — ${memo}` : ""}`,
    };
  } catch (error) {
    return { text: `연락처 저장 실패: ${error instanceof Error ? error.message : "알 수 없는 에러"}` };
  }
}

async function listContacts() {
  const contacts = await prisma.contact.findMany({
    orderBy: { name: "asc" },
    take: 50,
  });

  if (contacts.length === 0) {
    return { text: "등록된 연락처가 없어요." };
  }

  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: "📇 연락처 목록" } },
  ];

  for (const c of contacts) {
    blocks.push({
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*${c.name}*\n${formatPhoneNumber(c.phoneNumber)}` },
        { type: "mrkdwn", text: c.memo ?? "_메모 없음_" },
      ],
    });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `총 ${contacts.length}명` }],
  });

  return { response_type: "ephemeral" as const, text: " ", blocks };
}

async function deleteContact(name: string) {
  const contacts = await prisma.contact.findMany({
    where: { name: { contains: name } },
  });

  if (contacts.length === 0) {
    return { text: `"${name}" 검색 결과 없음.` };
  }

  if (contacts.length > 1) {
    const list = contacts.map((c) => `• ${c.name} (${formatPhoneNumber(c.phoneNumber)})`).join("\n");
    return { text: `"${name}" 검색 결과 ${contacts.length}명. 정확한 이름으로 다시:\n${list}` };
  }

  // 메시지 로그의 FK 참조 해제 후 삭제
  await prisma.messageLog.updateMany({
    where: { contactId: contacts[0].id },
    data: { contactId: null },
  });
  await prisma.contact.delete({ where: { id: contacts[0].id } });
  return { text: `연락처 삭제: ${contacts[0].name} (${formatPhoneNumber(contacts[0].phoneNumber)})` };
}
