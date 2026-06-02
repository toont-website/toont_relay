export type PartnerChatPartnerType = "expert" | "supplier";

export type PartnerChatDirection = "customer" | "agent" | "system";
export type PartnerChatStatus = "open" | "closed";

export const DEFAULT_PARTNER_CHAT_CLOSED_MESSAGE =
  "상담이 종료되었습니다. 문의해주셔서 감사합니다. 추가 문의가 필요하시면 새 채팅을 시작해주세요.";

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

export interface PartnerChatThreadPayload {
  status: PartnerChatStatus;
  messages: PartnerChatMessagePayload[];
}

export const PARTNER_CHAT_TYPE_LABELS: Record<PartnerChatPartnerType, string> = {
  expert: "건축 설계자",
  supplier: "건축 자재 업체",
};
