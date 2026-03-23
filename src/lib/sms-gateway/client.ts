import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/config/env";
import type {
  SmsGatewaySendResponse,
  SmsGatewayMessageStatus,
  SmsGatewayDevice,
} from "./types";

interface SmsGatewayClientConfig {
  baseUrl: string;
  username: string;
  password: string;
  webhookSecret: string;
}

export class SmsGatewayClient {
  private readonly baseUrl: string;
  private readonly basicAuth: string;
  private readonly webhookSecret: string;

  constructor(config: SmsGatewayClientConfig) {
    this.baseUrl = config.baseUrl;
    this.basicAuth = Buffer.from(`${config.username}:${config.password}`).toString("base64");
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
          Authorization: `Basic ${this.basicAuth}`,
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
          Authorization: `Basic ${this.basicAuth}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`메시지 상태 조회 실패: ${response.status}`);
    }

    return response.json();
  }

  async getDevice(): Promise<SmsGatewayDevice> {
    const response = await fetch(
      `${this.baseUrl}/api/3rdparty/v1/device`,
      {
        headers: {
          Authorization: `Basic ${this.basicAuth}`,
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `기기 상태 조회 실패: ${response.status} ${response.statusText} — ${errorText}`
      );
    }

    const data: SmsGatewayDevice[] = await response.json();
    if (data.length === 0) {
      throw new Error("등록된 기기가 없습니다");
    }
    return data[0];
  }

  verifyWebhookSignature(signature: string, body: string, timestamp: string): boolean {
    if (!signature || !timestamp) {
      return false;
    }

    try {
      const expected = createHmac("sha256", this.webhookSecret)
        .update(body + timestamp)
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
      username: env.SMS_GATEWAY_USERNAME,
      password: env.SMS_GATEWAY_PASSWORD,
      webhookSecret: env.SMS_GATEWAY_WEBHOOK_SECRET,
    });
  }
  return _client;
}
