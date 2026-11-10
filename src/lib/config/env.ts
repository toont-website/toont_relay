import { z } from "zod";

const envSchema = z.object({
  SLACK_BOT_TOKEN: z.string().startsWith("xoxb-"),
  SLACK_SIGNING_SECRET: z.string().min(1),
  // 슬랙 앱을 바꾸는 동안 예전 앱의 서명 비밀값(옮긴 뒤 지운다)
  SLACK_SIGNING_SECRET_LEGACY: z.string().min(1).optional(),
  SLACK_CHANNEL_CS_SMS: z.string().startsWith("C"),
  SLACK_CHANNEL_ALERT: z.string().startsWith("C"),
  SLACK_CHANNEL_PARTNER_CHAT: z.string().startsWith("C").optional(),
  SLACK_CHANNEL_PARTNER_CHAT_EXPERT: z.string().startsWith("C").optional(),
  SLACK_CHANNEL_PARTNER_CHAT_SUPPLIER: z.string().startsWith("C").optional(),
  PARTNER_CHAT_WEBHOOK_SECRET: z.string().min(16).optional(),
  SMS_GATEWAY_URL: z.string().url(),
  SMS_GATEWAY_USERNAME: z.string().min(1),
  SMS_GATEWAY_PASSWORD: z.string().min(1),
  SMS_GATEWAY_WEBHOOK_SECRET: z.string().min(1),
  DATABASE_URL: z.string().startsWith("mysql://"),
  APP_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CS_TOOL_API_URL: z.string().url(),
  CS_TOOL_API_KEY: z.string().min(1),
  CS_TOOL_WEBHOOK_SECRET: z.string().min(1),
  SLACK_CHANNEL_ORDER: z.string().startsWith("C"),
  SLACK_CHANNEL_INVENTORY: z.string().startsWith("C"),
  SLACK_CHANNEL_OPERATION: z.string().startsWith("C"),
  CRON_SECRET: z.string().min(1),
  HEALTH_CHECK_DEVICE_THRESHOLD_MINUTES: z.coerce.number().int().min(1).default(30),
  // 스테이징 CS(렌탈 이상 접수 시험): 서명 비밀값, 답을 보낼 CS API, 시험 채널. 없으면 스테이징 사건은 받지 않는다.
  CS_STAGING_WEBHOOK_SECRET: z.string().min(1).optional(),
  CS_STAGING_API_URL: z.string().url().optional(),
  CS_STAGING_API_KEY: z.string().min(1).optional(),
  SLACK_CHANNEL_STAGING_TEST: z.string().startsWith("C").optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`환경변수 검증 실패:\n${formatted}`);
  }
  return result.data;
}

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = validateEnv();
  }
  return _env;
}
