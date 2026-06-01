import { describe, expect, it } from "vitest";
import { buildPartnerChatInquiryMessage } from "../partner-chat";

describe("buildPartnerChatInquiryMessage", () => {
  it("파트너 채팅 문의를 답장하기 버튼이 있는 Slack 메시지로 만든다", () => {
    const result = buildPartnerChatInquiryMessage({
      conversationId: "chat_123",
      partnerType: "supplier",
      company: "오파크",
      identifier: "611-86-02821",
      contactName: "김툰트",
      email: "partner@opq.ooo",
      phone: "010-1234-5678",
      inquiryType: "온라인 쇼룸 구축 상담",
      message: "제품 자료를 기반으로 온라인 쇼룸을 만들고 싶습니다.",
      createdAt: new Date("2026-06-01T05:24:00.000Z"),
    });

    expect(result.text).toBe("💬 건축 자재 업체 문의: 오파크");
    expect(result.attachments[0].color).toBe("#111111");

    const blocks = result.attachments[0]!.blocks as any[];
    expect(blocks[0].text.text).toContain("*새 파트너 채팅 문의*");
    expect(blocks[0].text.text).toContain("건축 자재 업체");
    expect(JSON.stringify(blocks)).toContain("오파크");
    expect(JSON.stringify(blocks)).toContain("partner@opq.ooo");
    expect(JSON.stringify(blocks)).toContain("제품 자료를 기반으로 온라인 쇼룸");

    const actionsBlock = blocks.find((block: any) => block.type === "actions") as any;
    expect(actionsBlock).toBeTruthy();
    expect(actionsBlock.elements[0].action_id).toBe("reply_partner_chat");
    expect(actionsBlock.elements[0].text.text).toBe("답장하기");
    expect(JSON.parse(actionsBlock.elements[0].value)).toEqual({
      conversationId: "chat_123",
      threadTs: null,
    });
  });
});
