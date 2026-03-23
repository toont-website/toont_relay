import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/config/env";
import { getSmsGatewayClient } from "@/lib/sms-gateway/client";
import { getSlackClient } from "@/lib/slack/client";
import {
  buildHealthAlertMessage,
  buildHealthRecoveryMessage,
} from "@/lib/slack/messages/health-alert";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "error";
type DeviceStatus = "ok" | "stale" | "error";

interface HealthChecks {
  mysql: CheckStatus;
  smsGateway: CheckStatus;
  device: DeviceStatus;
}

async function runHealthChecks(env: ReturnType<typeof getEnv>): Promise<{
  checks: HealthChecks;
  deviceLastSeen: Date | null;
  deviceMinutesAgo: number | null;
}> {
  const checks: HealthChecks = {
    mysql: "error",
    smsGateway: "error",
    device: "error",
  };
  let deviceLastSeen: Date | null = null;
  let deviceMinutesAgo: number | null = null;

  // MySQL
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.mysql = "ok";
  } catch (error) {
    logger.error({ error }, "Health check: MySQL 연결 실패");
  }

  // SMS Gateway
  try {
    const res = await fetch(`${env.SMS_GATEWAY_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) checks.smsGateway = "ok";
  } catch (error) {
    logger.error({ error }, "Health check: SMS Gateway 응답 없음");
  }

  // Device
  try {
    const smsClient = getSmsGatewayClient();
    const device = await smsClient.getDevice();
    deviceLastSeen = new Date(device.lastSeen);
    deviceMinutesAgo = Math.floor(
      (Date.now() - deviceLastSeen.getTime()) / (1000 * 60)
    );

    if (deviceMinutesAgo <= env.HEALTH_CHECK_DEVICE_THRESHOLD_MINUTES) {
      checks.device = "ok";
    } else {
      checks.device = "stale";
    }
  } catch (error) {
    logger.error({ error }, "Health check: 기기 상태 조회 실패");
  }

  return { checks, deviceLastSeen, deviceMinutesAgo };
}

function isHealthy(checks: HealthChecks): boolean {
  return checks.mysql === "ok" && checks.smsGateway === "ok" && checks.device === "ok";
}

export async function GET(request: NextRequest) {
  const env = getEnv();

  // CRON_SECRET 인증
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (token !== env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { checks, deviceLastSeen, deviceMinutesAgo } = await runHealthChecks(env);
  const currentlyHealthy = isHealthy(checks);

  // 이전 상태 조회
  const lastLog = await prisma.healthCheckLog.findFirst({
    orderBy: { createdAt: "desc" },
  });

  const wasHealthy = lastLog
    ? lastLog.mysqlStatus === "ok" &&
      lastLog.gatewayStatus === "ok" &&
      lastLog.deviceStatus === "ok"
    : true; // 첫 실행이면 정상 상태로 간주

  // 현재 상태 기록
  await prisma.healthCheckLog.create({
    data: {
      mysqlStatus: checks.mysql,
      gatewayStatus: checks.smsGateway,
      deviceStatus: checks.device,
      deviceLastSeen,
      alertSent: false,
    },
  });

  const slackClient = getSlackClient();

  // 상태 전환 감지
  if (wasHealthy && !currentlyHealthy) {
    // 정상 → 장애: 알림 발송
    const message = buildHealthAlertMessage({
      checks,
      device:
        deviceMinutesAgo !== null && deviceLastSeen
          ? { lastSeen: deviceLastSeen.toISOString(), minutesAgo: deviceMinutesAgo }
          : undefined,
    });

    try {
      await slackClient.chat.postMessage({
        channel: env.SLACK_CHANNEL_ALERT,
        ...message,
      });

      await prisma.healthCheckLog.updateMany({
        where: { createdAt: { gte: new Date(Date.now() - 1000) } },
        data: { alertSent: true },
      });

      logger.info({ checks }, "장애 알림 발송 완료");
    } catch (error) {
      logger.error({ error }, "장애 알림 발송 실패");
    }
  } else if (!wasHealthy && currentlyHealthy) {
    // 장애 → 정상: 복구 알림
    const firstFailLog = await prisma.healthCheckLog.findFirst({
      where: {
        OR: [
          { mysqlStatus: { not: "ok" } },
          { gatewayStatus: { not: "ok" } },
          { deviceStatus: { not: "ok" } },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    const downMinutes = firstFailLog
      ? Math.floor((Date.now() - firstFailLog.createdAt.getTime()) / (1000 * 60))
      : 0;

    const message = buildHealthRecoveryMessage({
      downDurationMinutes: downMinutes,
    });

    try {
      await slackClient.chat.postMessage({
        channel: env.SLACK_CHANNEL_ALERT,
        ...message,
      });

      logger.info({ downMinutes }, "복구 알림 발송 완료");
    } catch (error) {
      logger.error({ error }, "복구 알림 발송 실패");
    }
  }

  // 오래된 로그 정리 (7일 이상)
  await prisma.healthCheckLog.deleteMany({
    where: {
      createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
  });

  return NextResponse.json({
    status: currentlyHealthy ? "healthy" : "unhealthy",
    checks,
    stateChanged: wasHealthy !== currentlyHealthy,
    timestamp: new Date().toISOString(),
  });
}
