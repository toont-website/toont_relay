import { prisma } from "@/lib/db/prisma";
import type {
  PartnerChatConversationPayload,
  PartnerChatInquiryInput,
  PartnerChatMessagePayload,
  PartnerChatPartnerType,
  PartnerChatStatus,
  PartnerChatThreadPayload,
} from "@/lib/partner-chat/types";
import { DEFAULT_PARTNER_CHAT_CLOSED_MESSAGE } from "@/lib/partner-chat/types";

export function makeCustomerLabel(params: { company: string; contactName: string }) {
  return `${params.company} ${params.contactName}`;
}

function isPrismaUniqueError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function createPartnerChatConversation(input: PartnerChatInquiryInput) {
  const conversation = await prisma.partnerChatConversation.create({
    data: {
      partnerType: input.partnerType,
      company: input.company,
      identifier: input.identifier,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
      inquiryType: input.inquiryType,
      visitorSessionId: input.visitorSessionId ?? null,
      messages: {
        create: {
          direction: "customer",
          message: input.message,
        },
      },
    },
  });

  return conversation;
}

export async function markPartnerChatSlackThread(params: {
  conversationId: string;
  slackChannelId: string;
  slackMessageTs?: string | null;
  slackThreadTs?: string | null;
}) {
  await prisma.partnerChatConversation.update({
    where: { id: params.conversationId },
    data: {
      slackChannelId: params.slackChannelId,
      slackMessageTs: params.slackMessageTs ?? null,
      slackThreadTs: params.slackThreadTs ?? params.slackMessageTs ?? null,
    },
  });
}

export async function getPartnerChatConversationPayload(
  conversationId: string
): Promise<PartnerChatConversationPayload | null> {
  const conversation = await prisma.partnerChatConversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation) return null;

  const firstCustomerMessage = await prisma.partnerChatMessage.findFirst({
    where: { conversationId, direction: "customer" },
    orderBy: { createdAt: "asc" },
  });

  return {
    conversationId: conversation.id,
    partnerType: conversation.partnerType as PartnerChatConversationPayload["partnerType"],
    company: conversation.company,
    identifier: conversation.identifier,
    contactName: conversation.contactName,
    email: conversation.email,
    phone: conversation.phone,
    inquiryType: conversation.inquiryType,
    message: firstCustomerMessage?.message ?? "",
    visitorSessionId: conversation.visitorSessionId,
    createdAt: conversation.createdAt,
    threadTs: conversation.slackThreadTs,
  };
}

export async function getPartnerChatConversationForSlack(conversationId: string) {
  const conversation = await prisma.partnerChatConversation.findUnique({
    where: { id: conversationId },
  });
  if (!conversation) return null;

  return {
    id: conversation.id,
    customerLabel: makeCustomerLabel(conversation),
    slackThreadTs: conversation.slackThreadTs,
  };
}

export async function appendCustomerPartnerChatMessage(params: {
  conversationId: string;
  visitorSessionId?: string | null;
  message: string;
}) {
  const conversation = await prisma.partnerChatConversation.findUnique({
    where: { id: params.conversationId },
  });
  if (!conversation) return null;
  if (conversation.status === "closed") return null;
  if (
    conversation.visitorSessionId &&
    params.visitorSessionId &&
    conversation.visitorSessionId !== params.visitorSessionId
  ) {
    return null;
  }

  const message = await prisma.partnerChatMessage.create({
    data: {
      conversationId: params.conversationId,
      direction: "customer",
      message: params.message,
    },
  });

  return {
    conversation,
    message,
    customerLabel: makeCustomerLabel(conversation),
  };
}

export async function createAgentPartnerChatMessage(params: {
  conversationId: string;
  message: string;
  slackUserId: string;
  slackActionId: string;
  threadTs?: string | null;
}) {
  const conversation = await prisma.partnerChatConversation.findUnique({
    where: { id: params.conversationId },
  });
  if (!conversation) {
    throw new Error("Partner chat conversation not found");
  }
  if (conversation.status === "closed") {
    throw new Error("Partner chat conversation is closed");
  }

  try {
    await prisma.partnerChatMessage.create({
      data: {
        conversationId: params.conversationId,
        direction: "agent",
        message: params.message,
        slackActionId: params.slackActionId,
        slackUserId: params.slackUserId,
      },
    });
  } catch (error) {
    if (!isPrismaUniqueError(error)) throw error;
  }

  return {
    customerLabel: makeCustomerLabel(conversation),
    slackThreadTs: params.threadTs ?? conversation.slackThreadTs,
    slackChannelId: conversation.slackChannelId,
    partnerType: conversation.partnerType as PartnerChatPartnerType,
  };
}

export async function listPartnerChatMessages(params: {
  conversationId: string;
  visitorSessionId?: string | null;
  limit?: number;
}): Promise<PartnerChatMessagePayload[]> {
  const conversation = await prisma.partnerChatConversation.findUnique({
    where: { id: params.conversationId },
    select: { visitorSessionId: true },
  });
  if (!conversation) return [];
  if (
    conversation.visitorSessionId &&
    params.visitorSessionId &&
    conversation.visitorSessionId !== params.visitorSessionId
  ) {
    return [];
  }

  const messages = await prisma.partnerChatMessage.findMany({
    where: { conversationId: params.conversationId },
    orderBy: { createdAt: "asc" },
    take: params.limit ? Math.max(1, params.limit) : undefined,
  });

  return messages.map((message) => ({
    id: message.id,
    direction: message.direction as PartnerChatMessagePayload["direction"],
    message: message.message,
    createdAt: message.createdAt,
    slackUserId: message.slackUserId,
  }));
}

function normalizePartnerChatStatus(status: string): PartnerChatStatus {
  return status === "closed" ? "closed" : "open";
}

export async function getPartnerChatThread(params: {
  conversationId: string;
  visitorSessionId?: string | null;
  limit?: number;
}): Promise<PartnerChatThreadPayload | null> {
  const conversation = await prisma.partnerChatConversation.findUnique({
    where: { id: params.conversationId },
    select: { visitorSessionId: true, status: true },
  });
  if (!conversation) return null;
  if (
    conversation.visitorSessionId &&
    params.visitorSessionId &&
    conversation.visitorSessionId !== params.visitorSessionId
  ) {
    return null;
  }

  return {
    status: normalizePartnerChatStatus(conversation.status),
    messages: await listPartnerChatMessages(params),
  };
}

export async function closePartnerChatConversation(params: {
  conversationId: string;
  slackUserId: string;
  slackActionId: string;
  closedAt?: Date;
  closingMessage?: string;
}) {
  const conversation = await prisma.partnerChatConversation.findUnique({
    where: { id: params.conversationId },
  });
  if (!conversation) return null;

  const closingMessage =
    params.closingMessage?.trim() || DEFAULT_PARTNER_CHAT_CLOSED_MESSAGE;

  if (conversation.status !== "closed") {
    await prisma.partnerChatConversation.update({
      where: { id: params.conversationId },
      data: { status: "closed" },
    });

    try {
      await prisma.partnerChatMessage.create({
        data: {
          conversationId: params.conversationId,
          direction: "system",
          message: closingMessage,
          slackActionId: params.slackActionId,
          slackUserId: params.slackUserId,
          ...(params.closedAt ? { createdAt: params.closedAt } : {}),
        },
      });
    } catch (error) {
      if (!isPrismaUniqueError(error)) throw error;
    }
  }

  return {
    customerLabel: makeCustomerLabel(conversation),
    slackThreadTs: conversation.slackThreadTs,
    slackChannelId: conversation.slackChannelId,
    partnerType: conversation.partnerType as PartnerChatPartnerType,
    status: "closed" as const,
    closingMessage,
  };
}
