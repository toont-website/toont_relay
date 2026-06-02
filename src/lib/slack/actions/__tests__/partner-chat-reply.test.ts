import { describe, expect, it } from "vitest";
import {
  buildPartnerChatCompletedMessage,
  buildPartnerChatReplyModalView,
  parsePartnerChatCompleteAction,
  parsePartnerChatReplySubmission,
} from "../partner-chat-reply";

describe("partner chat Slack reply action helpers", () => {
  it("대화 id와 최근 대화를 포함한 답장 모달을 만든다", () => {
    const view = buildPartnerChatReplyModalView({
      conversationId: "chat_123",
      customerLabel: "오파크 김툰트",
      threadTs: "1717223040.000000",
      recentMessages: [
        {
          direction: "customer",
          message: "쇼룸 구축 상담을 받고 싶습니다.",
          createdAt: new Date("2026-06-01T05:24:00.000Z"),
        },
      ],
    });

    expect(view.type).toBe("modal");
    expect(view.callback_id).toBe("partner_chat_reply_modal");
    expect(JSON.parse(view.private_metadata)).toEqual({
      conversationId: "chat_123",
      threadTs: "1717223040.000000",
    });
    expect(JSON.stringify(view.blocks)).toContain("오파크 김툰트");
    expect(JSON.stringify(view.blocks)).toContain("쇼룸 구축 상담");
  });

  it("답장 모달 제출 payload에서 메시지를 파싱한다", () => {
    const parsed = parsePartnerChatReplySubmission({
      user: { id: "U123" },
      view: {
        id: "V123",
        private_metadata: JSON.stringify({
          conversationId: "chat_123",
          threadTs: "1717223040.000000",
        }),
        state: {
          values: {
            message_block: {
              message_input: {
                value: "확인 후 오늘 중으로 안내드리겠습니다.",
              },
            },
          },
        },
      },
    });

    expect(parsed).toEqual({
      conversationId: "chat_123",
      message: "확인 후 오늘 중으로 안내드리겠습니다.",
      slackUserId: "U123",
      slackActionId: "partner_chat_reply_V123",
      threadTs: "1717223040.000000",
    });
  });

  it("메시지가 비어 있으면 Slack 모달 field error를 반환한다", () => {
    const parsed = parsePartnerChatReplySubmission({
      user: { id: "U123" },
      view: {
        id: "V123",
        private_metadata: JSON.stringify({ conversationId: "chat_123" }),
        state: {
          values: {
            message_block: {
              message_input: {
                value: "   ",
              },
            },
          },
        },
      },
    });

    expect(parsed).toEqual({
      response_action: "errors",
      errors: { message_block: "답장 내용을 입력해주세요" },
    });
  });

  it("대화 완료 버튼 payload에서 대화 id와 스레드 ts를 파싱한다", () => {
    const parsed = parsePartnerChatCompleteAction({
      user: { id: "U123" },
      actions: [
        {
          value: JSON.stringify({
            conversationId: "chat_123",
            threadTs: "1717223040.000000",
          }),
        },
      ],
    });

    expect(parsed).toEqual({
      conversationId: "chat_123",
      slackUserId: "U123",
      slackActionId: "partner_chat_complete_chat_123_U123",
      threadTs: "1717223040.000000",
    });
  });

  it("대화 완료 Slack 스레드 안내 메시지를 만든다", () => {
    const message = buildPartnerChatCompletedMessage({
      customerLabel: "오파크 김툰트",
      senderUserId: "U123",
      closingMessage: "상담이 종료되었습니다.",
    });

    expect(message.text).toBe("✅ 오파크 김툰트 파트너 채팅 종료");
    expect(JSON.stringify(message.attachments)).toContain("<@U123>");
    expect(JSON.stringify(message.attachments)).toContain("상담이 종료되었습니다.");
  });
});
