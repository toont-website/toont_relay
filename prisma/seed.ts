import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const contacts = [
  { name: "필름집", phoneNumber: "+8201012345678", memo: "필름 작업 업체" },
  { name: "우리퀵", phoneNumber: "+8201023456789", memo: "서울 배차" },
  { name: "부산기사님", phoneNumber: "+8201034567890", memo: "부산 배차" },
];

async function main() {
  for (const contact of contacts) {
    await prisma.contact.upsert({
      where: { phoneNumber: contact.phoneNumber },
      update: { name: contact.name, memo: contact.memo },
      create: contact,
    });
  }
  console.log(`시드 완료: ${contacts.length}개 연락처`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
