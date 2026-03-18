import { describe, expect, it, vi, beforeEach } from "vitest";
import { SmsGatewayClient } from "../client";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const basicAuth = Buffer.from("test-user:test-pass").toString("base64");

describe("SmsGatewayClient", () => {
  let client: SmsGatewayClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SmsGatewayClient({
      baseUrl: "http://sms-backend:3080",
      username: "test-user",
      password: "test-pass",
      webhookSecret: "test-secret",
    });
  });

  describe("sendSMS", () => {
    it("SMS 발송 성공", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "msg-123",
          state: "Pending",
          message: "테스트 메시지",
          phoneNumbers: ["+821012345678"],
          createdAt: "2026-03-18T14:00:00Z",
        }),
      });

      const result = await client.sendSMS("+821012345678", "테스트 메시지");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://sms-backend:3080/api/3rdparty/v1/message",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/json",
          }),
        })
      );
      expect(result.id).toBe("msg-123");
      expect(result.state).toBe("Pending");
    });

    it("SMS 발송 실패 시 에러", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "서버 에러",
      });

      await expect(
        client.sendSMS("+821012345678", "테스트")
      ).rejects.toThrow("SMS 발송 실패");
    });
  });

  describe("getMessageStatus", () => {
    it("메시지 상태 조회 성공", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "msg-123",
          state: "Delivered",
        }),
      });

      const result = await client.getMessageStatus("msg-123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://sms-backend:3080/api/3rdparty/v1/message/msg-123",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Basic ${basicAuth}`,
          }),
        })
      );
      expect(result.id).toBe("msg-123");
      expect(result.state).toBe("Delivered");
    });

    it("메시지 상태 조회 실패 시 에러", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(
        client.getMessageStatus("not-exist")
      ).rejects.toThrow("메시지 상태 조회 실패");
    });
  });

  describe("verifyWebhookSignature", () => {
    it("유효한 서명 -> true", async () => {
      const body = '{"event":"sms:received"}';
      const crypto = await import("node:crypto");
      const expectedSig = crypto
        .createHmac("sha256", "test-secret")
        .update(body)
        .digest("hex");

      const result = client.verifyWebhookSignature(expectedSig, body);
      expect(result).toBe(true);
    });

    it("잘못된 서명 -> false", () => {
      const result = client.verifyWebhookSignature("invalid-sig", "body");
      expect(result).toBe(false);
    });
  });
});
