import { describe, expect, it } from "vitest";
import { buildSmsSentMessage } from "../sms-sent";

describe("buildSmsSentMessage", () => {
  it("발신 메시지 Block Kit 포맷 생성", () => {
    const result = buildSmsSentMessage({
      recipientName: "김철수 (010-1234-5678)",
      phoneNumber: "+821012345678",
      message: "내일 배송 예정입니다",
      senderUserId: "U123",
      gatewayMessageId: "msg-456",
    });

    expect(result.text).toBe("SMS 발신: 김철수 (010-1234-5678)");
    expect(result.blocks).toHaveLength(4);
    expect(result.blocks[0].text.text).toContain("<@U123>");
    expect(result.blocks[2].text.text).toBe("내일 배송 예정입니다");
  });
});
