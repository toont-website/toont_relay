import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendCustomerPartnerChatMessage,
  closePartnerChatConversation,
} from "../service";

const db = vi.hoisted(() => ({
  partnerChatConversation: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  partnerChatMessage: {
    create: vi.fn(),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: db,
}));

describe("partner chat service", () => {
  beforeEach(() => {
    db.partnerChatConversation.findUnique.mockReset();
    db.partnerChatConversation.update.mockReset();
    db.partnerChatMessage.create.mockReset();
  });

  it("대화를 closed로 바꾸고 고객에게 보일 종료 시스템 메시지를 저장한다", async () => {
    const closedAt = new Date("2026-06-02T06:00:00.000Z");
    db.partnerChatConversation.findUnique.mockResolvedValueOnce({
      id: "chat_123",
      company: "오파크",
      contactName: "김툰트",
      partnerType: "supplier",
      status: "open",
      slackChannelId: "CSUPPLIER",
      slackThreadTs: "1717223040.000000",
    });
    db.partnerChatConversation.update.mockResolvedValueOnce({ id: "chat_123" });
    db.partnerChatMessage.create.mockResolvedValueOnce({
      id: "msg_closed",
      direction: "system",
      message: "상담이 종료되었습니다.",
      createdAt: closedAt,
    });

    const result = await closePartnerChatConversation({
      conversationId: "chat_123",
      slackUserId: "U123",
      slackActionId: "partner_chat_complete_A1",
      closedAt,
    });

    expect(db.partnerChatConversation.update).toHaveBeenCalledWith({
      where: { id: "chat_123" },
      data: { status: "closed" },
    });
    expect(db.partnerChatMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: "chat_123",
        direction: "system",
        slackActionId: "partner_chat_complete_A1",
        slackUserId: "U123",
      }),
    });
    expect(result).toMatchObject({
      customerLabel: "오파크 김툰트",
      slackChannelId: "CSUPPLIER",
      slackThreadTs: "1717223040.000000",
      partnerType: "supplier",
      status: "closed",
    });
  });

  it("closed 대화에는 고객 메시지를 추가하지 않는다", async () => {
    db.partnerChatConversation.findUnique.mockResolvedValueOnce({
      id: "chat_123",
      visitorSessionId: "visitor_1",
      status: "closed",
    });

    const result = await appendCustomerPartnerChatMessage({
      conversationId: "chat_123",
      visitorSessionId: "visitor_1",
      message: "추가 문의입니다.",
    });

    expect(result).toBeNull();
    expect(db.partnerChatMessage.create).not.toHaveBeenCalled();
  });
});
