import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getSmsGatewayClient } from "@/lib/sms-gateway/client";
import { getEnv } from "@/lib/config/env";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "error";
type DeviceStatus = "ok" | "stale" | "error";

interface HealthStatus {
  status: "ok" | "degraded" | "error";
  checks: {
    mysql: CheckStatus;
    smsGateway: CheckStatus;
    device: DeviceStatus;
  };
  device?: {
    lastSeen: string;
    minutesAgo: number;
  };
  timestamp: string;
}

export async function GET() {
  const env = getEnv();
  const checks = {
    mysql: "error" as CheckStatus,
    smsGateway: "error" as CheckStatus,
    device: "error" as DeviceStatus,
  };

  let deviceInfo: HealthStatus["device"] | undefined;

  // MySQL 체크
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.mysql = "ok";
  } catch {
    // error stays
  }

  // SMS Gateway 서버 체크
  try {
    const res = await fetch(`${env.SMS_GATEWAY_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) checks.smsGateway = "ok";
  } catch {
    // error stays
  }

  // 기기 연결 상태 체크
  try {
    const smsClient = getSmsGatewayClient();
    const device = await smsClient.getDevice();
    const lastSeenDate = new Date(device.lastSeen);
    const minutesAgo = Math.floor(
      (Date.now() - lastSeenDate.getTime()) / (1000 * 60)
    );

    deviceInfo = {
      lastSeen: device.lastSeen,
      minutesAgo,
    };

    if (minutesAgo <= env.HEALTH_CHECK_DEVICE_THRESHOLD_MINUTES) {
      checks.device = "ok";
    } else {
      checks.device = "stale";
    }
  } catch {
    checks.device = "error";
  }

  const allOk = checks.mysql === "ok" && checks.smsGateway === "ok" && checks.device === "ok";
  const hasError = checks.mysql === "error" || checks.smsGateway === "error" || checks.device === "error";

  const status = allOk ? "ok" : hasError ? "error" : "degraded";

  const health: HealthStatus = {
    status,
    checks,
    ...(deviceInfo && { device: deviceInfo }),
    timestamp: new Date().toISOString(),
  };

  const httpStatus = status === "ok" ? 200 : status === "degraded" ? 200 : 503;

  return NextResponse.json(health, { status: httpStatus });
}
