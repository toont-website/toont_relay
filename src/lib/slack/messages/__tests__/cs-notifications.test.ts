import { describe, expect, it } from "vitest";
import {
  buildAlimtalkDailySummarySlackMessage,
  buildOrderReminderSlackMessage,
  resolveSlackChannelId,
} from "../cs-notifications";

describe("CS notification Slack messages", () => {
  it("지정 채널이 유효하면 payload 채널을 사용하고 아니면 fallback 사용", () => {
    expect(resolveSlackChannelId("C012ABCDEF", "CDEFAULT")).toBe("C012ABCDEF");
    expect(resolveSlackChannelId("G012ABCDEF", "CDEFAULT")).toBe("CDEFAULT");
    expect(resolveSlackChannelId(null, "CDEFAULT")).toBe("CDEFAULT");
  });

  it("주문 리마인드 메시지 생성", () => {
    const message = buildOrderReminderSlackMessage({
      channelId: "C012ABCDEF",
      reminderType: "delivery_delay_due",
      label: "변경 배송예정일",
      targetDate: "2026-06-02",
      order: {
        id: "order-1",
        customerName: "홍길동",
        phone: "01012345678",
        address: "서울",
        productName: "테이블",
        deliveryEstimatedTime: "14:00",
      },
    }, "CDEFAULT");

    expect(message.channel).toBe("C012ABCDEF");
    expect(message.text).toContain("변경 배송예정일");
    expect(message.attachments[0].blocks[0].text.text).toContain("홍길동");
    expect(message.attachments[0].blocks[0].text.text).toContain("14:00");
  });

  it("알림톡 요약 메시지는 이력 버튼을 포함", () => {
    const message = buildAlimtalkDailySummarySlackMessage({
      channelId: "bad",
      summaryDate: "2026-06-01",
      totalSent: 1,
      logsUrl: "https://cs.toont.co.kr/?view=alimtalk-logs",
      items: [
        { operationCode: "IN-003", operationName: "포인트 적립 내역 안내", count: 1 },
        { operationCode: "IN-006", operationName: "A/S 방문 당일 안내", count: 0 },
      ],
    }, "CDEFAULT");

    expect(message.channel).toBe("CDEFAULT");
    expect(message.text).toBe("전날 자동 알림톡 발송 요약: 1건");
    expect(message.attachments[0].blocks[0].text.text).toContain("IN-006");
    expect(message.attachments[0].blocks[1].elements[0].text.text).toBe("발송 이력 보기");
  });
});
