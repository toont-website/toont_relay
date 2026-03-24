import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { getCsToolClient } from "@/lib/cs-tool/client";
import { getSlackClient } from "@/lib/slack/client";
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const env = getEnv();
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (token !== env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = getCsToolClient();
  const slackClient = getSlackClient();

  const result = await client.getOperations();
  const board = result.data;
  if (!board) {
    return NextResponse.json(
      { error: "Failed to fetch operations" },
      { status: 500 }
    );
  }

  // KST 기준 날짜 계산 (UTC+9)
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const kstTomorrow = new Date(kstNow.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = kstTomorrow.toISOString().split("T")[0];
  const todayStr = kstNow.toISOString().split("T")[0];

  let alertCount = 0;

  for (const stage of board.stages) {
    for (const order of stage.orders) {
      if (!order.stageDeadline) continue;

      const deadlineDate = new Date(order.stageDeadline);
      const deadlineKst = new Date(deadlineDate.getTime() + 9 * 60 * 60 * 1000);
      const deadlineStr = deadlineKst.toISOString().split("T")[0];
      if (deadlineStr !== tomorrowStr) continue;

      // 중복 방지
      try {
        await prisma.deadlineAlertLog.create({
          data: {
            orderId: order.id,
            stageId: stage.id,
            alertDate: todayStr,
          },
        });
      } catch (error: any) {
        if (error?.code === "P2002") {
          // 이미 발송됨
          continue;
        }
        throw error;
      }

      // 알림 발송
      await slackClient.chat.postMessage({
        channel: env.SLACK_CHANNEL_OPERATION,
        text: " ",
        attachments: [
          {
            color: "#FFB800",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `⏰ *마감 임박 알림*\n\n📦 ${order.orderId ?? order.customerName} — ${order.customerName} / ${order.itemDescription ?? "-"} x${order.quantity}\n   현재 단계: ${stage.name}\n   마감일: 내일 (${tomorrowStr})`,
                },
              },
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "주문 상세" },
                    action_id: "view_order_detail",
                    value: order.id,
                  },
                  {
                    type: "button",
                    text: { type: "plain_text", text: "다음 단계로" },
                    action_id: "move_next_stage",
                    value: order.id,
                    style: "primary",
                  },
                ],
              },
            ],
          },
        ],
      });

      alertCount++;
      logger.info(
        { orderId: order.id, stageName: stage.name, deadline: tomorrowStr },
        "마감 D-1 알림 발송"
      );
    }
  }

  // 오래된 로그 정리 (30일)
  await prisma.deadlineAlertLog.deleteMany({
    where: {
      sentAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
  });

  return NextResponse.json({
    status: "ok",
    alertsSent: alertCount,
    timestamp: new Date().toISOString(),
  });
}
