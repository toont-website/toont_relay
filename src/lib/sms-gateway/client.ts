import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/config/env";
import type {
  SmsGatewaySendResponse,
  SmsGatewayMessageStatus,
} from "./types";

interface SmsGatewayClientConfig {
  baseUrl: string;
  jwtToken: string;
  webhookSecret: string;
}

export class SmsGatewayClient {
  private readonly baseUrl: string;
  private readonly jwtToken: string;
  private readonly webhookSecret: string;

  constructor(config: SmsGatewayClientConfig) {
    this.baseUrl = config.baseUrl;
    this.jwtToken = config.jwtToken;
    this.webhookSecret = config.webhookSecret;
  }

  async sendSMS(
    phoneNumber: string,
    message: string
  ): Promise<SmsGatewaySendResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/3rdparty/v1/message`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.jwtToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          phoneNumbers: [phoneNumber],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `SMS 발송 실패: ${response.status} ${response.statusText} — ${errorText}`
      );
    }

    return response.json();
  }

  async getMessageStatus(messageId: string): Promise<SmsGatewayMessageStatus> {
    const response = await fetch(
      `${this.baseUrl}/api/3rdparty/v1/message/${messageId}`,
      {
        headers: {
          Authorization: `Bearer ${this.jwtToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`메시지 상태 조회 실패: ${response.status}`);
    }

    return response.json();
  }

  verifyWebhookSignature(signature: string, body: string): boolean {
    try {
      const expected = createHmac("sha256", this.webhookSecret)
        .update(body)
        .digest("hex");

      const sigBuf = Buffer.from(signature, "hex");
      const expectedBuf = Buffer.from(expected, "hex");

      if (sigBuf.length !== expectedBuf.length) {
        return false;
      }

      return timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  }
}

let _client: SmsGatewayClient | null = null;

export function getSmsGatewayClient(): SmsGatewayClient {
  if (!_client) {
    const env = getEnv();
    _client = new SmsGatewayClient({
      baseUrl: env.SMS_GATEWAY_URL,
      jwtToken: env.SMS_GATEWAY_JWT_TOKEN,
      webhookSecret: env.SMS_GATEWAY_WEBHOOK_SECRET,
    });
  }
  return _client;
}
