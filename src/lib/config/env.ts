import { z } from "zod";

const envSchema = z.object({
  SLACK_BOT_TOKEN: z.string().startsWith("xoxb-"),
  SLACK_SIGNING_SECRET: z.string().min(1),
  SLACK_CHANNEL_CS_SMS: z.string().startsWith("C"),
  SMS_GATEWAY_URL: z.string().url(),
  SMS_GATEWAY_JWT_TOKEN: z.string().min(1),
  SMS_GATEWAY_WEBHOOK_SECRET: z.string().min(1),
  DATABASE_URL: z.string().startsWith("mysql://"),
  APP_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
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
