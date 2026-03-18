export type SmsDirection = "inbound" | "outbound";
export type SmsStatus = "sent" | "delivered" | "failed" | "received";

export interface SmsWebhookPayload {
  event: "sms:received";
  payload: {
    phoneNumber: string;
    message: string;
    receivedAt: string;
  };
}

export interface SmsSendRequest {
  phoneNumber: string;
  message: string;
}

export interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
  memo: string | null;
}
