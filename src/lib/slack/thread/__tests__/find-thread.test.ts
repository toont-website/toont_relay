import { describe, it, expect, vi, beforeEach } from "vitest";
import { findActiveThread } from "../find-thread";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    messageLog: {
      findFirst: vi.fn(),
    },
  },
}));

describe("findActiveThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("메시지 없으면 null 반환", async () => {
    vi.mocked(prisma.messageLog.findFirst).mockResolvedValue(null);
    const result = await findActiveThread("+821012345678");
    expect(result).toBeNull();
  });

  it("5일 이내 메시지 있으면 threadTs 반환", async () => {
    const recent = new Date();
    recent.setHours(recent.getHours() - 1);
    vi.mocked(prisma.messageLog.findFirst).mockResolvedValue({
      slackThreadTs: "1234567890.123456",
      createdAt: recent,
    } as any);

    const result = await findActiveThread("+821012345678");
    expect(result).toBe("1234567890.123456");
  });

  it("5일 초과 메시지면 null 반환", async () => {
    const old = new Date();
    old.setDate(old.getDate() - 6);
    vi.mocked(prisma.messageLog.findFirst).mockResolvedValue({
      slackThreadTs: "1234567890.123456",
      createdAt: old,
    } as any);

    const result = await findActiveThread("+821012345678");
    expect(result).toBeNull();
  });
});
