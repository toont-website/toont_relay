import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import type { PartnerChatPartnerType } from "@/lib/partner-chat/types";

type PartnerChatChannelEnv = {
  SLACK_CHANNEL_PARTNER_CHAT?: string;
  SLACK_CHANNEL_PARTNER_CHAT_EXPERT?: string;
  SLACK_CHANNEL_PARTNER_CHAT_SUPPLIER?: string;
};

export function resolvePartnerChatSlackChannelId(
  env: PartnerChatChannelEnv,
  partnerType: PartnerChatPartnerType
) {
  const channelByType =
    partnerType === "supplier"
      ? env.SLACK_CHANNEL_PARTNER_CHAT_SUPPLIER
      : env.SLACK_CHANNEL_PARTNER_CHAT_EXPERT;

  return channelByType ?? env.SLACK_CHANNEL_PARTNER_CHAT;
}

function getPartnerChatWebhookSecret() {
  const env = getEnv();
  if (!env.PARTNER_CHAT_WEBHOOK_SECRET) {
    throw new Error("Partner chat relay env is not configured");
  }

  return env.PARTNER_CHAT_WEBHOOK_SECRET;
}

export function getPartnerChatEnv(partnerType: PartnerChatPartnerType) {
  const env = getEnv();
  const slackChannelId = resolvePartnerChatSlackChannelId(env, partnerType);
  if (!env.PARTNER_CHAT_WEBHOOK_SECRET || !slackChannelId) {
    throw new Error("Partner chat relay env is not configured");
  }

  return {
    webhookSecret: env.PARTNER_CHAT_WEBHOOK_SECRET,
    slackChannelId,
  };
}

export function verifyPartnerChatRequest(request: NextRequest): NextResponse | null {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  let webhookSecret: string;
  try {
    webhookSecret = getPartnerChatWebhookSecret();
  } catch {
    return NextResponse.json(
      { error: "Partner chat relay is not configured" },
      { status: 503 }
    );
  }

  if (!token || token !== webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
