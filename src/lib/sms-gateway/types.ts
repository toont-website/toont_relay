export interface SmsGatewaySendRequest {
  message: string;
  phoneNumbers: string[]; // E.164 형식
}

export interface SmsGatewaySendResponse {
  id: string;
  state: "Pending" | "Processed" | "Sent" | "Delivered" | "Failed";
  message: string;
  phoneNumbers: string[];
  createdAt: string;
}

export interface SmsGatewayWebhookEvent {
  event: "sms:received" | "sms:sent" | "sms:delivered" | "sms:failed";
  payload: {
    id: string;
    phoneNumber: string;
    message: string;
    receivedAt: string;
  };
  webhookId: string;
}

export interface SmsGatewayMessageStatus {
  id: string;
  state: "Pending" | "Processed" | "Sent" | "Delivered" | "Failed";
}

export interface SmsGatewayDevice {
  id: string;
  name: string;
  lastSeen: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
