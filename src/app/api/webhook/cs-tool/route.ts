import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/config/env";
import { getSlackClient } from "@/lib/slack/client";
import { logger } from "@/lib/logger";
import { formatPhoneNumber } from "@/lib/utils/phone";
import type { CsToolWebhookEvent } from "@/lib/cs-tool/types";

function verifyWebhookSignature(
  signature: string,
  timestamp: string,
  body: string,
  secret: string
): boolean {
  if (!signature || !timestamp) return false;

  // 5분 초과 거부 (replay attack 방지)
  const elapsed = Date.now() - new Date(timestamp).getTime();
  if (isNaN(elapsed) || elapsed > 5 * 60 * 1000) return false;

  try {
    const expected =
      "sha256=" +
      createHmac("sha256", secret)
        .update(`${timestamp}.${body}`)
        .digest("hex");

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);

    if (sigBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const env = getEnv();

  const signature = request.headers.get("x-webhook-signature") ?? "";
  const timestamp = request.headers.get("x-webhook-timestamp") ?? "";
  const eventType = request.headers.get("x-webhook-event") ?? "";

  if (!verifyWebhookSignature(signature, timestamp, body, env.CS_TOOL_WEBHOOK_SECRET)) {
    logger.warn({ eventType }, "CS Tool 웹훅 서명 검증 실패");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event: CsToolWebhookEvent = JSON.parse(body);
  logger.info({ event: event.event, payloadKeys: Object.keys(event.payload ?? {}) }, "CS Tool 웹훅 수신");

  const slackClient = getSlackClient();

  try {
    if (event.event === "order.created") {
      // payload 구조 자동 감지: { order: {...} } 또는 직접 order 객체
      const order = event.payload.order ?? event.payload;
      const phone = order.phone ? formatPhoneNumber(order.phone) : "-";

      await slackClient.chat.postMessage({
        channel: env.SLACK_CHANNEL_ORDER,
        text: " ",
        attachments: [
          {
            color: "#36C759",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `📋 *새 주문이 등록됐어요!*\n\n*고객:* ${order.customerName} (${phone})\n*상품:* ${order.itemDescription}\n*수량:* ${order.quantity}개${order.dueDate ? `\n*납기:* ${order.dueDate}` : ""}${order.channel ? `\n*채널:* ${order.channel}` : ""}`,
                },
              },
            ],
          },
        ],
      });
    }

    if (event.event === "order.status_changed") {
      const order = event.payload.order ?? event.payload;
      const changes = event.payload.changes ?? event.payload;
      const prevStatus = changes.previousStageName ?? changes.previousStatus ?? "-";
      const currStatus = changes.currentStageName ?? changes.currentStatus ?? "-";

      await slackClient.chat.postMessage({
        channel: env.SLACK_CHANNEL_OPERATION,
        text: " ",
        attachments: [
          {
            color: "#2196F3",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `🔄 *주문 상태가 변경됐어요*\n\n*고객:* ${order.customerName}\n*상품:* ${order.itemDescription} x${order.quantity}\n*변경:* ${prevStatus} → *${currStatus}*`,
                },
              },
            ],
          },
        ],
      });
    }

    if (event.event === "inventory.low_stock") {
      const item = event.payload.item ?? event.payload;

      await slackClient.chat.postMessage({
        channel: env.SLACK_CHANNEL_INVENTORY,
        text: " ",
        attachments: [
          {
            color: "#FF3B30",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `⚠️ *재고가 부족해요!*\n\n*품목:* ${item.name} (${item.sku})\n*현재:* ${item.quantity}${item.unit}\n*기준:* ${item.minQuantity}${item.unit}\n\n발주를 검토해주세요.`,
                },
              },
            ],
          },
        ],
      });
    }
  } catch (error) {
    logger.error({ event: event.event, error }, "CS Tool 웹훅 처리 실패");
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
