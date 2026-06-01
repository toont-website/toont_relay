export type PartnerChatPartnerType = "expert" | "supplier";

export type PartnerChatDirection = "customer" | "agent" | "system";

export interface PartnerChatInquiryInput {
  partnerType: PartnerChatPartnerType;
  company: string;
  identifier: string;
  contactName: string;
  email: string;
  phone: string;
  inquiryType: string;
  message: string;
  visitorSessionId?: string | null;
}

export interface PartnerChatConversationPayload extends PartnerChatInquiryInput {
  conversationId: string;
  createdAt: Date;
  threadTs?: string | null;
}

export interface PartnerChatMessagePayload {
  id?: string;
  direction: PartnerChatDirection;
  message: string;
  createdAt: Date;
  slackUserId?: string | null;
}

export const PARTNER_CHAT_TYPE_LABELS: Record<PartnerChatPartnerType, string> = {
  expert: "건축 설계자",
  supplier: "건축 자재 업체",
};
