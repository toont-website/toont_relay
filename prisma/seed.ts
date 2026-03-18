import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const contacts = [
  { name: "강동현", phoneNumber: "+8201095337464", memo: null },
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
