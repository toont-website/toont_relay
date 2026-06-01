import { getSlackClient } from "@/lib/slack/client";
import { getPartnerChatEnv } from "@/lib/partner-chat/auth";
import {
  createAgentPartnerChatMessage,
  getPartnerChatConversationForSlack,
  listPartnerChatMessages,
} from "@/lib/partner-chat/service";
import { buildPartnerChatAgentSentMessage } from "@/lib/slack/messages/partner-chat";
import type { PartnerChatMessagePayload } from "@/lib/partner-chat/types";

type ReplySubmission =
  | {
      conversationId: string;
      message: string;
      slackUserId: string;
      slackActionId: string;
      threadTs: string | null;
    }
  | {
      response_action: "errors";
      errors: Record<string, string>;
    };

type SlackPartnerChatPayload = {
  actions?: Array<{ value?: string }>;
  trigger_id?: string;
  user: { id: string };
  view?: {
    id?: string;
    private_metadata?: string;
    state?: {
      values?: {
        message_block?: {
          message_input?: {
            value?: string;
          };
        };
      };
    };
  };
};

function formatTime(value: Date): string {
  return value.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function buildPartnerChatReplyModalView(params: {
  conversationId: string;
  customerLabel: string;
  threadTs?: string | null;
  recentMessages: PartnerChatMessagePayload[];
}) {
  const contextBlocks = params.recentMessages.flatMap((message) => {
    const sender =
      message.direction === "agent"
        ? "상담사"
        : message.direction === "system"
          ? "시스템"
          : params.customerLabel;

    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${sender}* _${formatTime(message.createdAt)}_\n>${message.message}`,
        },
      },
    ];
  });

  return {
    type: "modal" as const,
    callback_id: "partner_chat_reply_modal",
    private_metadata: JSON.stringify({
      conversationId: params.conversationId,
      threadTs: params.threadTs ?? null,
    }),
    title: { type: "plain_text", text: "답장하기" },
    submit: { type: "plain_text", text: "전송" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `*받는 사람:* ${params.customerLabel}` },
      },
      ...contextBlocks,
      ...(contextBlocks.length > 0 ? [{ type: "divider" }] : []),
      {
        type: "input",
        block_id: "message_block",
        label: { type: "plain_text", text: "내용" },
        element: {
          type: "plain_text_input",
          action_id: "message_input",
          multiline: true,
        },
      },
    ],
  };
}

export function parsePartnerChatReplySubmission(payload: SlackPartnerChatPayload): ReplySubmission {
  let metadata: { conversationId?: string; threadTs?: string | null } = {};
  try {
    metadata = JSON.parse(payload.view?.private_metadata ?? "{}");
  } catch {
    metadata = {};
  }

  const message = String(
    payload.view?.state?.values?.message_block?.message_input?.value ?? ""
  ).trim();

  if (!metadata.conversationId || !message) {
    return {
      response_action: "errors",
      errors: {
        ...(!message ? { message_block: "답장 내용을 입력해주세요" } : {}),
      },
    };
  }

  return {
    conversationId: metadata.conversationId,
    message,
    slackUserId: payload.user.id,
    slackActionId: `partner_chat_reply_${payload.view?.id ?? "unknown"}`,
    threadTs: metadata.threadTs ?? null,
  };
}

export async function handleReplyPartnerChat(payload: SlackPartnerChatPayload) {
  const action = payload.actions?.[0];
  const triggerId = payload.trigger_id;
  if (!action?.value || !triggerId) return;

  let value: { conversationId?: string; threadTs?: string | null };
  try {
    value = JSON.parse(action.value);
  } catch {
    return;
  }

  if (!value.conversationId) return;

  const conversation = await getPartnerChatConversationForSlack(value.conversationId);
  if (!conversation) return;

  const recentMessages = await listPartnerChatMessages({
    conversationId: value.conversationId,
    limit: 5,
  });

  const slackClient = getSlackClient();
  await slackClient.views.open({
    trigger_id: triggerId,
    view: buildPartnerChatReplyModalView({
      conversationId: value.conversationId,
      customerLabel: conversation.customerLabel,
      threadTs: value.threadTs ?? conversation.slackThreadTs,
      recentMessages,
    }) as never,
  });
}

export async function executePartnerChatReply(payload: SlackPartnerChatPayload) {
  const parsed = parsePartnerChatReplySubmission(payload);
  if ("response_action" in parsed) return parsed;

  const result = await createAgentPartnerChatMessage(parsed);
  const partnerChatEnv = getPartnerChatEnv();
  const slackClient = getSlackClient();

  await slackClient.chat.postMessage({
    channel: partnerChatEnv.slackChannelId,
    thread_ts: parsed.threadTs ?? result.slackThreadTs ?? undefined,
    ...buildPartnerChatAgentSentMessage({
      customerLabel: result.customerLabel,
      message: parsed.message,
      senderUserId: parsed.slackUserId,
    }),
  });

  return null;
}
