import { describe, expect, it } from "vitest";
import { resolvePartnerChatSlackChannelId } from "../auth";

describe("resolvePartnerChatSlackChannelId", () => {
  it("건축 자재 업체 문의는 공급사 알림 채널을 우선 사용한다", () => {
    expect(
      resolvePartnerChatSlackChannelId(
        {
          SLACK_CHANNEL_PARTNER_CHAT: "CFALLBACK",
          SLACK_CHANNEL_PARTNER_CHAT_EXPERT: "CDEMO",
          SLACK_CHANNEL_PARTNER_CHAT_SUPPLIER: "CSUPPLIER",
        },
        "supplier"
      )
    ).toBe("CSUPPLIER");
  });

  it("건축 설계자 문의는 데모 알림 채널을 우선 사용한다", () => {
    expect(
      resolvePartnerChatSlackChannelId(
        {
          SLACK_CHANNEL_PARTNER_CHAT: "CFALLBACK",
          SLACK_CHANNEL_PARTNER_CHAT_EXPERT: "CDEMO",
          SLACK_CHANNEL_PARTNER_CHAT_SUPPLIER: "CSUPPLIER",
        },
        "expert"
      )
    ).toBe("CDEMO");
  });

  it("유형별 채널이 없으면 기존 단일 채널 설정으로 fallback한다", () => {
    expect(
      resolvePartnerChatSlackChannelId(
        {
          SLACK_CHANNEL_PARTNER_CHAT: "CFALLBACK",
        },
        "supplier"
      )
    ).toBe("CFALLBACK");
  });
});
