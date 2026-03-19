import { describe, expect, it } from "vitest";
import { buildSmsReceivedMessage } from "../sms-received";

describe("buildSmsReceivedMessage", () => {
  it("연락처 매칭 시 이름 표시", () => {
    const result = buildSmsReceivedMessage({
      senderName: "김철수",
      phoneNumber: "+821098765432",
      message: "목대 가능합니다",
      receivedAt: "2026-03-18T14:30:00Z",
      isNewThread: true,
    });
    expect(result.text).toContain("김철수");
    const blocks = result.attachments[0].blocks;
    expect(blocks[0].text.text).toContain("김철수");
    expect(blocks[0].text.text).toContain("010-9876-5432");
  });

  it("연락처 미매칭 시 번호만 표시", () => {
    const result = buildSmsReceivedMessage({
      senderName: null,
      phoneNumber: "+821011112222",
      message: "테스트",
      receivedAt: "2026-03-18T14:30:00Z",
      isNewThread: true,
    });
    expect(result.text).toContain("010-1111-2222");
  });

  it("답장하기 버튼 포함", () => {
    const result = buildSmsReceivedMessage({
      senderName: null,
      phoneNumber: "+821012345678",
      message: "테스트",
      receivedAt: "2026-03-18T14:30:00Z",
      isNewThread: true,
    });
    const blocks = result.attachments[0].blocks;
    const actionsBlock = blocks.find((b: any) => b.type === "actions");
    expect(actionsBlock).toBeTruthy();
    expect(actionsBlock!.elements[0].action_id).toBe("reply_sms");
  });
});
