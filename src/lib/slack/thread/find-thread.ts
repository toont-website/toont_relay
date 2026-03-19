import { prisma } from "@/lib/db/prisma";

const THREAD_EXPIRY_DAYS = 5;

export async function findActiveThread(phoneNumber: string): Promise<string | null> {
  const latest = await prisma.messageLog.findFirst({
    where: {
      phoneNumber,
      slackThreadTs: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: { slackThreadTs: true, createdAt: true },
  });

  if (!latest?.slackThreadTs) {
    return null;
  }

  const elapsed = Date.now() - latest.createdAt.getTime();
  const expiryMs = THREAD_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

  if (elapsed > expiryMs) {
    return null;
  }

  return latest.slackThreadTs;
}
