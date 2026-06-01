import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";

export function getPartnerChatEnv() {
  const env = getEnv();
  if (!env.PARTNER_CHAT_WEBHOOK_SECRET || !env.SLACK_CHANNEL_PARTNER_CHAT) {
    throw new Error("Partner chat relay env is not configured");
  }

  return {
    webhookSecret: env.PARTNER_CHAT_WEBHOOK_SECRET,
    slackChannelId: env.SLACK_CHANNEL_PARTNER_CHAT,
  };
}

export function verifyPartnerChatRequest(request: NextRequest): NextResponse | null {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  let env: ReturnType<typeof getPartnerChatEnv>;
  try {
    env = getPartnerChatEnv();
  } catch {
    return NextResponse.json(
      { error: "Partner chat relay is not configured" },
      { status: 503 }
    );
  }

  if (!token || token !== env.webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
