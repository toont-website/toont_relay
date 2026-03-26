import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/config/env";
import { getSlackClient } from "@/lib/slack/client";
import { logger } from "@/lib/logger";
import { displayPhoneNumber } from "@/lib/utils/phone";
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
  logger.info({ event: event.event, data: event.data }, "CS Tool 웹훅 수신");

  const slackClient = getSlackClient();

  try {
    if (event.event === "order.created") {
      const order = event.data.order ?? event.data;
      const phone = order.phone ? displayPhoneNumber(order.phone) : "-";
      const stageName = order.currentStageName ?? "접수";
      const product = order.productNames ?? order.itemDescription ?? "-";
      const orderDesc = order.itemDescription ?? "-";

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
                  text: `📋 *새 주문이 등록됐어요!*\n\n*주문자:* ${order.customerName} (${phone})\n*주문내용:* ${orderDesc}\n*상품:* ${product}\n*단계:* ${stageName}${order.address ? `\n*주소:* ${order.address}` : ""}${order.dueDate ? `\n*납기:* ${order.dueDate}` : ""}\n\n<https://cs.toont.co.kr/?view=operations&orderId=${order.id}|CS Tool에서 관리하기>`,
                },
              },
            ],
          },
        ],
      });
    }

    if (event.event === "order.status_changed") {
      const order = event.data.order ?? event.data;
      const changes = event.data.changes ?? {};
      const phone = order.phone ? displayPhoneNumber(order.phone) : "-";
      const product = order.productNames ?? order.itemDescription ?? "-";
      const orderDesc = order.itemDescription ?? "-";
      const currStage = changes.currentStageName ?? changes.stageName ?? changes.toStageName ?? changes.currentStatus ?? order.currentStageName ?? "-";
      const prevStage = changes.previousStageName ?? changes.fromStageName ?? changes.previousStatus ?? "-";

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
                  text: `🔄 *주문 상태가 변경됐어요*\n\n*주문자:* ${order.customerName} (${phone})\n*주문내용:* ${orderDesc}\n*상품:* ${product}\n*단계:* ${prevStage} → *${currStage}*${order.address ? `\n*주소:* ${order.address}` : ""}\n\n<https://cs.toont.co.kr/?view=operations&orderId=${order.id}|CS Tool에서 관리하기>`,
                },
              },
            ],
          },
        ],
      });
    }

    if (event.event === "inventory.updated") {
      const item = event.data.item ?? event.data;
      const change = event.data.change ?? {};
      const isInbound = change.type === "inbound";
      const color = isInbound ? "#36C759" : "#2196F3";
      const icon = isInbound ? "📥 입고" : "📤 출고";
      const reason = change.reason ? ` · ${change.reason}` : "";

      await slackClient.chat.postMessage({
        channel: env.SLACK_CHANNEL_INVENTORY,
        text: " ",
        attachments: [
          {
            color,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `${icon} *${item.name}* (\`${item.sku}\`)\n>${isInbound ? "+" : "-"}${change.quantity ?? "?"}${item.unit ?? "개"}${reason}\n\n*현재 재고:* ${item.quantity}${item.unit ?? "개"}\n\n<https://cs.toont.co.kr/?view=inventory|재고 관리하기>`,
                },
              },
            ],
          },
        ],
      });
    }

    if (event.event === "inventory.low_stock") {
      const item = event.data.item ?? event.data;

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
                  text: `⚠️ *재고가 부족해요!*\n\n*품목:* ${item.name} (${item.sku})\n*현재:* ${item.quantity}${item.unit}\n*기준:* ${item.minQuantity}${item.unit}\n\n발주를 검토해주세요.\n\n<https://cs.toont.co.kr/?view=inventory|재고 관리하기>`,
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
