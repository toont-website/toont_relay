import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Contact 모델 제거됨 — 연락처는 CS Tool API에서 관리
  console.log("시드 완료 (현재 시드 데이터 없음)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
