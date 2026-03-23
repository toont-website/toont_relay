type CheckStatus = "ok" | "error";
type DeviceStatus = "ok" | "stale" | "error";

interface HealthAlertParams {
  checks: {
    mysql: CheckStatus;
    smsGateway: CheckStatus;
    device: DeviceStatus;
  };
  device?: {
    lastSeen: string;
    minutesAgo: number;
  };
}

interface HealthRecoveryParams {
  downDurationMinutes: number;
}

function statusEmoji(status: string): string {
  if (status === "ok") return ":white_check_mark:";
  if (status === "stale") return ":warning:";
  return ":x:";
}

function statusLabel(status: string): string {
  if (status === "ok") return "정상";
  if (status === "stale") return "응답 지연";
  return "장애";
}

function formatTime(): string {
  return new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function buildHealthAlertMessage(params: HealthAlertParams) {
  const { checks, device } = params;

  const lines = [
    `${statusEmoji(checks.mysql)} *MySQL*: ${statusLabel(checks.mysql)}`,
    `${statusEmoji(checks.smsGateway)} *SMS Gateway*: ${statusLabel(checks.smsGateway)}`,
    `${statusEmoji(checks.device)} *기기 연결*: ${statusLabel(checks.device)}`,
  ];

  if (device && checks.device !== "ok") {
    lines.push(`    └ 마지막 접속: ${device.minutesAgo}분 전`);
  }

  const blocks: Record<string, unknown>[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "<!channel> 서비스 장애가 감지되었어요.",
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: lines.join("\n"),
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `감지 시각: ${formatTime()}` }],
    },
  ];

  return {
    text: "서비스 장애 감지",
    attachments: [{ color: "#FF3B30", blocks }],
  };
}

export function buildHealthRecoveryMessage(params: HealthRecoveryParams) {
  const { downDurationMinutes } = params;

  const blocks: Record<string, unknown>[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "서비스가 복구되었어요.",
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `:white_check_mark: *MySQL*: 정상`,
          `:white_check_mark: *SMS Gateway*: 정상`,
          `:white_check_mark: *기기 연결*: 정상`,
          ``,
          `장애 지속 시간: 약 ${downDurationMinutes}분`,
        ].join("\n"),
      },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `복구 시각: ${formatTime()}` }],
    },
  ];

  return {
    text: "서비스 복구 완료",
    attachments: [{ color: "#36C759", blocks }],
  };
}
