import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

interface HealthStatus {
  status: "ok" | "error";
  checks: {
    mysql: "ok" | "error";
    smsGateway: "ok" | "error";
  };
  timestamp: string;
}

export async function GET() {
  const checks = {
    mysql: "error" as "ok" | "error",
    smsGateway: "error" as "ok" | "error",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.mysql = "ok";
  } catch {
    // error stays
  }

  try {
    const smsGatewayUrl = process.env.SMS_GATEWAY_URL ?? "http://sms-gateway:3080";
    const res = await fetch(`${smsGatewayUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) checks.smsGateway = "ok";
  } catch {
    // error stays
  }

  const allOk = Object.values(checks).every((v) => v === "ok");

  const health: HealthStatus = {
    status: allOk ? "ok" : "error",
    checks,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(health, { status: allOk ? 200 : 503 });
}
