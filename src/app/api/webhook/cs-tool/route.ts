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
        text: `📋 새 주문: ${order.customerName} — ${product}`,
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

    // 단계 이동 (접수→제작 등)
    if (event.event === "order.stage_changed") {
      const order = event.data.order ?? event.data;
      const changes = event.data.changes ?? {};
      const phone = order.phone ? displayPhoneNumber(order.phone) : "-";
      const product = order.productNames ?? order.itemDescription ?? "-";
      const orderDesc = order.itemDescription ?? "-";
      const prevStage = changes.previousStageName ?? "-";
      const currStage = changes.currentStageName ?? order.currentStageName ?? "-";

      await slackClient.chat.postMessage({
        channel: env.SLACK_CHANNEL_OPERATION,
        text: `🔄 ${order.customerName}: ${prevStage} → ${currStage}`,
        attachments: [
          {
            color: "#2196F3",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `🔄 *단계가 변경됐어요*\n\n*주문자:* ${order.customerName} (${phone})\n*주문내용:* ${orderDesc}\n*상품:* ${product}\n*단계:* ${prevStage} → *${currStage}*${order.address ? `\n*주소:* ${order.address}` : ""}\n\n<https://cs.toont.co.kr/?view=operations&orderId=${order.id}|CS Tool에서 관리하기>`,
                },
              },
            ],
          },
        ],
      });
    }

    // 마감일 변경 (구캘 드래그 등)
    if (event.event === "order.deadline_changed") {
      const order = event.data.order ?? event.data;
      const changes = event.data.changes ?? {};
      const phone = order.phone ? displayPhoneNumber(order.phone) : "-";
      const product = order.productNames ?? order.itemDescription ?? "-";
      const stageName = changes.stageName ?? order.currentStageName ?? "-";
      const prevDeadline = changes.previousDeadline ? new Date(changes.previousDeadline).toLocaleDateString("ko-KR") : "-";
      const newDeadline = changes.newDeadline ? new Date(changes.newDeadline).toLocaleDateString("ko-KR") : "-";
      const source = changes.source === "google_calendar" ? " (구글 캘린더)" : "";

      await slackClient.chat.postMessage({
        channel: env.SLACK_CHANNEL_OPERATION,
        text: `📅 ${order.customerName}: 마감 ${prevDeadline} → ${newDeadline}`,
        attachments: [
          {
            color: "#FF9500",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `📅 *마감일이 변경됐어요*${source}\n\n*주문자:* ${order.customerName} (${phone})\n*상품:* ${product}\n*단계:* ${stageName}\n*마감:* ${prevDeadline} → *${newDeadline}*\n\n<https://cs.toont.co.kr/?view=operations&orderId=${order.id}|CS Tool에서 관리하기>`,
                },
              },
            ],
          },
        ],
      });
    }

    // 상태 변경 (완료/취소)
    if (event.event === "order.status_changed") {
      const order = event.data.order ?? event.data;
      const changes = event.data.changes ?? {};
      const phone = order.phone ? displayPhoneNumber(order.phone) : "-";
      const product = order.productNames ?? order.itemDescription ?? "-";
      const prevStatus = changes.previousStatus ?? "-";
      const currStatus = changes.currentStatus ?? order.status ?? "-";

      const statusMap: Record<string, string> = {
        pending: "대기",
        in_progress: "진행중",
        completed: "완료",
        cancelled: "취소",
      };

      const color = currStatus === "completed" ? "#36C759"
        : currStatus === "cancelled" ? "#FF3B30"
        : "#2196F3";

      await slackClient.chat.postMessage({
        channel: env.SLACK_CHANNEL_OPERATION,
        text: `🔄 ${order.customerName}: ${statusMap[prevStatus] ?? prevStatus} → ${statusMap[currStatus] ?? currStatus}`,
        attachments: [
          {
            color,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `🔄 *주문 상태가 변경됐어요*\n\n*주문자:* ${order.customerName} (${phone})\n*상품:* ${product}\n*상태:* ${statusMap[prevStatus] ?? prevStatus} → *${statusMap[currStatus] ?? currStatus}*\n\n<https://cs.toont.co.kr/?view=operations&orderId=${order.id}|CS Tool에서 관리하기>`,
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

      // 실제 페이로드 로그 (디버깅용)
      logger.info({ item, change }, "inventory.updated 페이로드");

      const itemName = item.name ?? item.productName ?? item.sku ?? "품목";
      const itemSku = item.sku ?? "-";
      const unit = item.unit ?? "개";
      const currentQty = item.quantity ?? item.stock ?? "?";
      const changeQty = Math.abs(change.quantity ?? 0);

      // 음수 수량이면 실제로는 입고 (주문 취소/복원)
      const isNegativeOutbound = change.type !== "inbound" && (change.quantity ?? 0) < 0;
      const isInbound = change.type === "inbound" || isNegativeOutbound;
      const color = isInbound ? "#36C759" : "#2196F3";
      const icon = isInbound ? "📥 입고" : "📤 출고";
      const sign = isInbound ? "+" : "-";
      const reason = change.reason ? ` · ${change.reason}` : "";

      await slackClient.chat.postMessage({
        channel: env.SLACK_CHANNEL_INVENTORY,
        text: `${icon} ${itemName} ${sign}${changeQty}`,
        attachments: [
          {
            color,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `${icon} *${itemName}* (\`${itemSku}\`)\n>${sign}${changeQty}${unit}${reason}\n\n*현재 재고:* ${currentQty}${unit}\n\n<https://cs.toont.co.kr/?view=inventory|재고 관리하기>`,
                },
              },
            ],
          },
        ],
      });
    }

    if (event.event === "inventory.low_stock") {
      const item = event.data.item ?? event.data;
      const itemName = item.name ?? item.productName ?? item.sku ?? "품목";
      const unit = item.unit ?? "개";
      const currentQty = item.quantity ?? item.stock ?? "?";
      const minQty = item.minQuantity ?? item.minStock ?? "?";

      await slackClient.chat.postMessage({
        channel: env.SLACK_CHANNEL_INVENTORY,
        text: `⚠️ 재고 부족: ${itemName} (${currentQty}${unit})`,
        attachments: [
          {
            color: "#FF3B30",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `⚠️ *재고가 부족해요!*\n\n*품목:* ${itemName} (${item.sku ?? "-"})\n*현재:* ${currentQty}${unit}\n*기준:* ${minQty}${unit}\n\n발주를 검토해주세요.\n\n<https://cs.toont.co.kr/?view=inventory|재고 관리하기>`,
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
