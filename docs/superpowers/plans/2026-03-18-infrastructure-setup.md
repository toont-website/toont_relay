# 경유서버 + SMS Gateway + 슬랙봇 인프라 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 슬랙 `#CS-문자` 채널에서 SMS 수신/발신이 되는 경유서버 인프라를 구축한다.

**Architecture:** Next.js 16 API Routes + @slack/web-api (수동 서명 검증) + android-sms-gateway + MySQL + Docker Compose. GCE VM 1대에서 nginx 리버스 프록시로 외부 트래픽을 받고, Docker 내부 네트워크로 서비스 간 통신한다.

**Tech Stack:** Next.js 16, TypeScript, @slack/web-api, Prisma (MySQL), pino, zod, Docker Compose, nginx

> **참고:** Slack Bolt SDK는 Next.js App Router와 호환 문제가 있어서(ExpressReceiver의 requestHandler가 private API, fake req/res 불완전) 사용하지 않는다. `@slack/web-api` + 수동 서명 검증으로 직접 구현한다. 현재 스코프가 `/문자` 커맨드 하나이므로 보일러플레이트가 많지 않다.

**Spec:** `docs/superpowers/specs/2026-03-18-infrastructure-setup-design.md`

---

## Task 1: Docker 인프라 파일 세팅

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `nginx/nginx.conf`
- Create: `nginx/conf.d/default.conf`
- Create: `.dockerignore`
- Create: `.env.example`

- [ ] **Step 1: `.dockerignore` 작성**

```
node_modules
.next
.git
*.md
docs/
.env*
```

- [ ] **Step 2: 멀티스테이지 `Dockerfile` 작성**

```dockerfile
# Stage 1: Dependencies
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
RUN pnpm build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
```

- [ ] **Step 3: `docker-compose.yml` 작성**

```yaml
services:
  app:
    build: .
    expose:
      - "3000"
    environment:
      - DATABASE_URL=mysql://toont:toont_password@mysql:3306/toont_relay
      - SMS_GATEWAY_URL=http://sms-gateway:3080
    env_file:
      - .env
    depends_on:
      mysql:
        condition: service_healthy
    networks:
      - internal
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  sms-gateway:
    image: capcom6/sms-gateway:latest
    expose:
      - "3080"
    environment:
      - ASG_GATEWAY_PRIVATE_TOKEN=${SMS_GATEWAY_JWT_TOKEN}
      - ASG_DATABASE_DIALECT=mysql
      - ASG_DATABASE_HOST=mysql
      - ASG_DATABASE_PORT=3306
      - ASG_DATABASE_USER=smsgateway
      - ASG_DATABASE_PASSWORD=smsgateway_password
      - ASG_DATABASE_NAME=sms_gateway
      - ASG_GATEWAY_WEBHOOKS_0_URL=http://app:3000/api/webhook/sms
      - ASG_GATEWAY_WEBHOOKS_0_EVENT=sms:received
    depends_on:
      mysql:
        condition: service_healthy
    networks:
      - internal
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3080/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  mysql:
    image: mysql:8.0
    environment:
      - MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD:-rootpassword}
      - MYSQL_DATABASE=sms_gateway
    volumes:
      - mysql_data:/var/lib/mysql
      - ./docker/init-db.sql:/docker-entrypoint-initdb.d/01-init.sql
    networks:
      - internal
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - certbot_data:/etc/letsencrypt:ro
      - certbot_webroot:/var/www/certbot:ro
    depends_on:
      - app
      - sms-gateway
    networks:
      - internal
    restart: unless-stopped

volumes:
  mysql_data:
  certbot_data:
  certbot_webroot:

networks:
  internal:
    driver: bridge
```

- [ ] **Step 4: MySQL 초기화 스크립트 작성**

Create `docker/init-db.sql`:

```sql
-- SMS Gateway용 DB 유저 (sms_gateway DB는 MYSQL_DATABASE로 자동 생성)
CREATE USER IF NOT EXISTS 'smsgateway'@'%' IDENTIFIED BY 'smsgateway_password';
GRANT ALL PRIVILEGES ON sms_gateway.* TO 'smsgateway'@'%';

-- 경유서버용 DB + 유저
CREATE DATABASE IF NOT EXISTS toont_relay CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'toont'@'%' IDENTIFIED BY 'toont_password';
GRANT ALL PRIVILEGES ON toont_relay.* TO 'toont'@'%';

FLUSH PRIVILEGES;
```

- [ ] **Step 5: nginx 설정 작성**

Create `nginx/nginx.conf`:

```nginx
worker_processes auto;
events {
    worker_connections 1024;
}
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent"';
    access_log /var/log/nginx/access.log main;
    error_log /var/log/nginx/error.log warn;

    sendfile on;
    keepalive_timeout 65;

    # Rate limiting zone (SMS 발송 엔드포인트)
    limit_req_zone $binary_remote_addr zone=sms_send:10m rate=30r/m;

    include /etc/nginx/conf.d/*.conf;
}
```

Create `nginx/conf.d/default.conf`:

```nginx
upstream app {
    server app:3000;
}

upstream sms_gateway {
    server sms-gateway:3080;
}

server {
    listen 80;
    server_name _;

    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # SMS Gateway 웹훅 — 외부 접근 차단 (Docker 내부에서만 접근)
    location = /api/webhook/sms {
        # Docker 내부 네트워크만 허용
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        allow 10.0.0.0/8;
        deny all;
        proxy_pass http://app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SMS 발송 관련 — rate limiting
    location /api/sms/ {
        limit_req zone=sms_send burst=5 nodelay;
        proxy_pass http://app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 나머지 API → Next.js
    location /api/ {
        proxy_pass http://app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SMS Gateway (CS폰 연결용)
    location /sms-gateway/ {
        proxy_pass http://sms_gateway/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Next.js 정적 파일 + 페이지
    location / {
        proxy_pass http://app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

- [ ] **Step 6: `.env.example` 작성**

```env
# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_CHANNEL_CS_SMS=C0XXXXXX

# SMS Gateway
SMS_GATEWAY_JWT_TOKEN=your-jwt-token
SMS_GATEWAY_URL=http://sms-gateway:3080
SMS_GATEWAY_WEBHOOK_SECRET=your-webhook-secret

# Database
DATABASE_URL=mysql://toont:toont_password@mysql:3306/toont_relay
MYSQL_ROOT_PASSWORD=rootpassword

# App
NODE_ENV=production
APP_URL=https://relay.toont.co.kr
```

- [ ] **Step 7: `next.config.ts`에 `output: 'standalone'` 추가**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 8: 커밋**

```bash
git add Dockerfile docker-compose.yml .dockerignore .env.example \
  docker/init-db.sql nginx/ next.config.ts
git commit -m "chore: Docker Compose + nginx + Dockerfile 인프라 세팅"
```

---

## Task 2: 환경변수 검증 + 공통 타입

**Files:**
- Create: `src/lib/config/env.ts`
- Create: `src/types/index.ts`
- Modify: `package.json` (zod 추가)

- [ ] **Step 1: zod 설치**

```bash
pnpm add zod
```

- [ ] **Step 2: `src/lib/config/env.ts` 작성**

```typescript
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
```

- [ ] **Step 3: `src/types/index.ts` 작성**

```typescript
export type SmsDirection = "inbound" | "outbound";

export type SmsStatus = "sent" | "delivered" | "failed" | "received";

export interface SmsWebhookPayload {
  event: "sms:received";
  payload: {
    phoneNumber: string;
    message: string;
    receivedAt: string;
  };
}

export interface SmsSendRequest {
  phoneNumber: string;
  message: string;
}

export interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
  memo: string | null;
}
```

- [ ] **Step 4: 커밋**

```bash
git add src/lib/config/env.ts src/types/index.ts package.json pnpm-lock.yaml
git commit -m "feat: 환경변수 zod 검증 + 공통 타입 정의"
```

---

## Task 3: Prisma + DB 스키마 + 시드

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/db/prisma.ts`
- Create: `prisma/seed.ts`
- Modify: `package.json` (prisma scripts + seed 설정)

- [ ] **Step 1: Prisma 설치**

```bash
pnpm add prisma @prisma/client
pnpm add -D tsx
```

- [ ] **Step 2: `prisma/schema.prisma` 작성**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model Contact {
  id          String       @id @default(cuid())
  name        String
  phoneNumber String       @unique // E.164: +821012345678
  memo        String?
  messages    MessageLog[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  @@index([name])
  @@index([phoneNumber])
}

model MessageLog {
  id             String   @id @default(cuid())
  direction      String   // "inbound" | "outbound"
  phoneNumber    String   // E.164
  message        String   @db.Text
  status         String   // "sent" | "delivered" | "failed" | "received"
  slackActionId  String?  @unique // 중복 전송 방지
  slackMessageTs String?  // 슬랙 메시지 ts (permalink용)
  contact        Contact? @relation(fields: [contactId], references: [id])
  contactId      String?
  createdAt      DateTime @default(now())

  @@index([phoneNumber])
  @@index([direction])
  @@index([createdAt])
}
```

- [ ] **Step 3: `src/lib/db/prisma.ts` 작성 (싱글톤)**

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 4: `prisma/seed.ts` 작성 (예시 연락처)**

```typescript
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const contacts = [
  { name: "필름집", phoneNumber: "+8201012345678", memo: "필름 작업 업체" },
  { name: "우리퀵", phoneNumber: "+8201023456789", memo: "서울 배차" },
  { name: "부산기사님", phoneNumber: "+8201034567890", memo: "부산 배차" },
];

async function main() {
  for (const contact of contacts) {
    await prisma.contact.upsert({
      where: { phoneNumber: contact.phoneNumber },
      update: { name: contact.name, memo: contact.memo },
      create: contact,
    });
  }
  console.log(`시드 완료: ${contacts.length}개 연락처`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 5: `package.json`에 prisma scripts 추가**

`package.json`의 `"scripts"`에 추가:

```json
"db:generate": "prisma generate",
"db:push": "prisma db push",
"db:migrate": "prisma migrate dev",
"db:seed": "tsx prisma/seed.ts",
"db:studio": "prisma studio"
```

`package.json` 최상위에 prisma seed 설정 추가:

```json
"prisma": {
  "seed": "tsx prisma/seed.ts"
}
```

- [ ] **Step 6: 로컬 개발용 `.env.local` 생성**

> **주의:** 이 파일은 gitignore 됨. 로컬에서 `docker-compose up mysql` 후 사용.

```env
SLACK_BOT_TOKEN=xoxb-dev-token
SLACK_SIGNING_SECRET=dev-signing-secret
SLACK_CHANNEL_CS_SMS=C0000000000

SMS_GATEWAY_URL=http://localhost:3080
SMS_GATEWAY_JWT_TOKEN=dev-jwt-token
SMS_GATEWAY_WEBHOOK_SECRET=dev-webhook-secret

DATABASE_URL=mysql://toont:toont_password@localhost:3306/toont_relay

APP_URL=http://localhost:3000
NODE_ENV=development
```

- [ ] **Step 7: 마이그레이션 테스트**

MySQL 컨테이너를 띄우고 마이그레이션 확인:

```bash
docker compose up mysql -d
# MySQL 준비 대기 (healthcheck 통과까지)
sleep 10
pnpm db:push
pnpm db:seed
```

Expected: "시드 완료: 3개 연락처" 출력

- [ ] **Step 8: 커밋**

```bash
git add prisma/ src/lib/db/prisma.ts package.json pnpm-lock.yaml
git commit -m "feat: Prisma + MySQL 스키마 (Contact, MessageLog) + 시드 데이터"
```

---

## Task 4: 전화번호 정규화 유틸리티 (TDD)

**Files:**
- Create: `src/lib/utils/phone.ts`
- Create: `src/lib/utils/__tests__/phone.test.ts`
- Modify: `package.json` (vitest 추가)

- [ ] **Step 1: vitest 설치**

```bash
pnpm add -D vitest
```

`package.json`의 `"scripts"`에 추가:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: 실패하는 테스트 작성**

Create `src/lib/utils/__tests__/phone.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { normalizePhoneNumber, formatPhoneNumber } from "../phone";

describe("normalizePhoneNumber", () => {
  it("010-1234-5678 → +821012345678", () => {
    expect(normalizePhoneNumber("010-1234-5678")).toBe("+821012345678");
  });

  it("01012345678 → +821012345678", () => {
    expect(normalizePhoneNumber("01012345678")).toBe("+821012345678");
  });

  it("+821012345678 → +821012345678 (이미 E.164)", () => {
    expect(normalizePhoneNumber("+821012345678")).toBe("+821012345678");
  });

  it("010 1234 5678 (공백) → +821012345678", () => {
    expect(normalizePhoneNumber("010 1234 5678")).toBe("+821012345678");
  });

  it("빈 문자열 → null", () => {
    expect(normalizePhoneNumber("")).toBeNull();
  });

  it("유효하지 않은 번호 → null", () => {
    expect(normalizePhoneNumber("12345")).toBeNull();
  });
});

describe("formatPhoneNumber", () => {
  it("+821012345678 → 010-1234-5678", () => {
    expect(formatPhoneNumber("+821012345678")).toBe("010-1234-5678");
  });

  it("+821012345678 → 010-1234-5678 (하이픈 포맷)", () => {
    expect(formatPhoneNumber("+821098765432")).toBe("010-9876-5432");
  });
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```bash
pnpm test src/lib/utils/__tests__/phone.test.ts
```

Expected: FAIL — `phone` 모듈 없음

- [ ] **Step 4: 구현**

Create `src/lib/utils/phone.ts`:

```typescript
/**
 * 한국 전화번호를 E.164 형식으로 정규화
 * "010-1234-5678" | "01012345678" | "+821012345678" → "+821012345678"
 * 유효하지 않으면 null 반환
 */
export function normalizePhoneNumber(input: string): string | null {
  const cleaned = input.replace(/[\s\-()]/g, "");

  if (cleaned === "") {
    return null;
  }

  // 이미 E.164 형식
  if (/^\+82\d{9,10}$/.test(cleaned)) {
    return cleaned;
  }

  // 한국 로컬 번호 (010, 011, 016, 017, 018, 019)
  if (/^01[0-9]\d{7,8}$/.test(cleaned)) {
    return `+82${cleaned.slice(1)}`;
  }

  return null;
}

/**
 * E.164 → 사람이 읽기 쉬운 포맷
 * "+821012345678" → "010-1234-5678"
 */
export function formatPhoneNumber(e164: string): string {
  const local = e164.replace(/^\+82/, "0");

  if (local.length === 11) {
    return `${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  }

  return local;
}
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```bash
pnpm test src/lib/utils/__tests__/phone.test.ts
```

Expected: 모든 테스트 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/lib/utils/ package.json pnpm-lock.yaml
git commit -m "feat: 전화번호 E.164 정규화 유틸리티 + 테스트"
```

---

## Task 5: SMS Gateway 타입 + API 클라이언트 (TDD)

**Files:**
- Create: `src/lib/sms-gateway/types.ts`
- Create: `src/lib/sms-gateway/client.ts`
- Create: `src/lib/sms-gateway/__tests__/client.test.ts`

- [ ] **Step 1: `src/lib/sms-gateway/types.ts` 작성**

```typescript
export interface SmsGatewaySendRequest {
  message: string;
  phoneNumbers: string[]; // E.164 형식
}

export interface SmsGatewaySendResponse {
  id: string;
  state: "Pending" | "Processed" | "Sent" | "Delivered" | "Failed";
  message: string;
  phoneNumbers: string[];
  createdAt: string;
}

export interface SmsGatewayWebhookEvent {
  event: "sms:received" | "sms:sent" | "sms:delivered" | "sms:failed";
  payload: {
    id: string;
    phoneNumber: string;
    message: string;
    receivedAt: string;
  };
  webhookId: string;
}

export interface SmsGatewayMessageStatus {
  id: string;
  state: "Pending" | "Processed" | "Sent" | "Delivered" | "Failed";
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

Create `src/lib/sms-gateway/__tests__/client.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SmsGatewayClient } from "../client";

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("SmsGatewayClient", () => {
  let client: SmsGatewayClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SmsGatewayClient({
      baseUrl: "http://sms-gateway:3080",
      jwtToken: "test-token",
      webhookSecret: "test-secret",
    });
  });

  describe("sendSMS", () => {
    it("SMS 발송 성공", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "msg-123",
          state: "Pending",
          message: "테스트 메시지",
          phoneNumbers: ["+821012345678"],
          createdAt: "2026-03-18T14:00:00Z",
        }),
      });

      const result = await client.sendSMS("+821012345678", "테스트 메시지");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://sms-gateway:3080/3rdparty/v1/message",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          }),
        })
      );
      expect(result.id).toBe("msg-123");
      expect(result.state).toBe("Pending");
    });

    it("SMS 발송 실패 시 에러", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "서버 에러",
      });

      await expect(
        client.sendSMS("+821012345678", "테스트")
      ).rejects.toThrow("SMS 발송 실패");
    });
  });

  describe("verifyWebhookSignature", () => {
    it("유효한 서명 → true", async () => {
      const body = '{"event":"sms:received"}';
      // HMAC-SHA256 of body with "test-secret"
      const crypto = await import("node:crypto");
      const expectedSig = crypto
        .createHmac("sha256", "test-secret")
        .update(body)
        .digest("hex");

      const result = client.verifyWebhookSignature(expectedSig, body);
      expect(result).toBe(true);
    });

    it("잘못된 서명 → false", () => {
      const result = client.verifyWebhookSignature("invalid-sig", "body");
      expect(result).toBe(false);
    });
  });
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```bash
pnpm test src/lib/sms-gateway/__tests__/client.test.ts
```

Expected: FAIL — `SmsGatewayClient` 없음

- [ ] **Step 4: 구현**

Create `src/lib/sms-gateway/client.ts`:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  SmsGatewaySendResponse,
  SmsGatewayMessageStatus,
} from "./types";

interface SmsGatewayClientConfig {
  baseUrl: string;
  jwtToken: string;
  webhookSecret: string;
}

export class SmsGatewayClient {
  private readonly baseUrl: string;
  private readonly jwtToken: string;
  private readonly webhookSecret: string;

  constructor(config: SmsGatewayClientConfig) {
    this.baseUrl = config.baseUrl;
    this.jwtToken = config.jwtToken;
    this.webhookSecret = config.webhookSecret;
  }

  async sendSMS(
    phoneNumber: string,
    message: string
  ): Promise<SmsGatewaySendResponse> {
    const response = await fetch(
      `${this.baseUrl}/3rdparty/v1/message`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.jwtToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          phoneNumbers: [phoneNumber],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `SMS 발송 실패: ${response.status} ${response.statusText} — ${errorText}`
      );
    }

    return response.json();
  }

  async getMessageStatus(messageId: string): Promise<SmsGatewayMessageStatus> {
    const response = await fetch(
      `${this.baseUrl}/3rdparty/v1/message/${messageId}`,
      {
        headers: {
          Authorization: `Bearer ${this.jwtToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`메시지 상태 조회 실패: ${response.status}`);
    }

    return response.json();
  }

  verifyWebhookSignature(signature: string, body: string): boolean {
    try {
      const expected = createHmac("sha256", this.webhookSecret)
        .update(body)
        .digest("hex");

      const sigBuf = Buffer.from(signature, "hex");
      const expectedBuf = Buffer.from(expected, "hex");

      if (sigBuf.length !== expectedBuf.length) {
        return false;
      }

      return timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```bash
pnpm test src/lib/sms-gateway/__tests__/client.test.ts
```

Expected: 모든 테스트 PASS

- [ ] **Step 6: SMS Gateway 클라이언트 싱글톤 팩토리 추가**

`src/lib/sms-gateway/client.ts` 하단에 추가:

```typescript
import { getEnv } from "@/lib/config/env";

let _client: SmsGatewayClient | null = null;

export function getSmsGatewayClient(): SmsGatewayClient {
  if (!_client) {
    const env = getEnv();
    _client = new SmsGatewayClient({
      baseUrl: env.SMS_GATEWAY_URL,
      jwtToken: env.SMS_GATEWAY_JWT_TOKEN,
      webhookSecret: env.SMS_GATEWAY_WEBHOOK_SECRET,
    });
  }
  return _client;
}
```

- [ ] **Step 7: 커밋**

```bash
git add src/lib/sms-gateway/
git commit -m "feat: SMS Gateway API 클라이언트 + HMAC 검증 + 테스트"
```

---

## Task 6: Slack 서명 검증 + WebClient 싱글톤 + API Routes

**Files:**
- Create: `src/lib/slack/verify.ts`
- Create: `src/lib/slack/client.ts`
- Create: `src/app/api/slack/command/route.ts`
- Create: `src/app/api/slack/action/route.ts`
- Create: `src/app/api/slack/event/route.ts`
- Create: `src/app/api/slack/options/route.ts`
- Create: `src/lib/slack/__tests__/verify.test.ts`
- Modify: `package.json` (@slack/web-api 추가)

> **왜 Bolt를 안 쓰는가:** Bolt의 `ExpressReceiver`는 Express req/res 인터페이스를 기대하는데, Next.js App Router는 Web Standard `Request`를 사용한다. fake req/res 어댑터를 만들면 Bolt 내부 API에 의존하게 되어 버전 업에 취약하다. 현재 스코프가 `/문자` 커맨드 하나이므로 `@slack/web-api` + 수동 서명 검증으로 충분하다.

- [ ] **Step 1: @slack/web-api 설치**

```bash
pnpm add @slack/web-api
```

- [ ] **Step 2: 실패하는 서명 검증 테스트 작성**

Create `src/lib/slack/__tests__/verify.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { verifySlackSignature } from "../verify";
import { createHmac } from "node:crypto";

const SIGNING_SECRET = "test-signing-secret";

function makeValidHeaders(body: string, timestamp?: number) {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const sigBasestring = `v0:${ts}:${body}`;
  const signature =
    "v0=" + createHmac("sha256", SIGNING_SECRET).update(sigBasestring).digest("hex");
  return { timestamp: String(ts), signature };
}

describe("verifySlackSignature", () => {
  it("유효한 서명 → true", () => {
    const body = "token=xxx&command=%2F문자";
    const { timestamp, signature } = makeValidHeaders(body);
    expect(verifySlackSignature(SIGNING_SECRET, signature, timestamp, body)).toBe(true);
  });

  it("잘못된 서명 → false", () => {
    expect(verifySlackSignature(SIGNING_SECRET, "v0=invalid", "12345", "body")).toBe(false);
  });

  it("5분 이상 된 타임스탬프 → false", () => {
    const body = "test";
    const oldTs = Math.floor(Date.now() / 1000) - 600; // 10분 전
    const { signature } = makeValidHeaders(body, oldTs);
    expect(verifySlackSignature(SIGNING_SECRET, signature, String(oldTs), body)).toBe(false);
  });
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```bash
pnpm test src/lib/slack/__tests__/verify.test.ts
```

Expected: FAIL — `verifySlackSignature` 없음

- [ ] **Step 4: 서명 검증 유틸 구현**

Create `src/lib/slack/verify.ts`:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Slack 요청의 서명을 검증한다.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  signingSecret: string,
  signature: string,
  timestamp: string,
  body: string
): boolean {
  // 5분 이상 된 요청은 거부 (replay attack 방지)
  const ts = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const expected =
    "v0=" + createHmac("sha256", signingSecret).update(sigBasestring).digest("hex");

  try {
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expected);
    if (sigBuf.length !== expectedBuf.length) {
      return false;
    }
    return timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: 테스트 실행 — 통과 확인**

```bash
pnpm test src/lib/slack/__tests__/verify.test.ts
```

Expected: 모든 테스트 PASS

- [ ] **Step 6: WebClient 싱글톤 작성**

Create `src/lib/slack/client.ts`:

```typescript
import { WebClient } from "@slack/web-api";
import { getEnv } from "@/lib/config/env";

let _client: WebClient | null = null;

export function getSlackClient(): WebClient {
  if (!_client) {
    const env = getEnv();
    _client = new WebClient(env.SLACK_BOT_TOKEN);
  }
  return _client;
}
```

- [ ] **Step 7: 슬랙 요청 파싱 헬퍼 작성**

`src/lib/slack/verify.ts` 하단에 추가:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";

/**
 * Next.js App Router에서 Slack 요청을 검증하고 body를 파싱한다.
 * 슬랙 재시도 요청(x-slack-retry-num > 0)은 200 OK로 무시한다.
 */
export async function parseSlackRequest(
  request: NextRequest
): Promise<{ body: string; params: URLSearchParams; payload?: any } | NextResponse> {
  // 슬랙 재시도 무시
  const retryNum = request.headers.get("x-slack-retry-num");
  if (retryNum && Number(retryNum) > 0) {
    return NextResponse.json({ ok: true });
  }

  const body = await request.text();
  const env = getEnv();
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  const signature = request.headers.get("x-slack-signature") ?? "";

  if (!verifySlackSignature(env.SLACK_SIGNING_SECRET, signature, timestamp, body)) {
    logger.warn("Slack 서명 검증 실패");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const params = new URLSearchParams(body);

  // action/options 요청은 payload 필드에 JSON이 들어있음
  const payloadStr = params.get("payload");
  const payload = payloadStr ? JSON.parse(payloadStr) : undefined;

  return { body, params, payload };
}
```

- [ ] **Step 8: API Routes 작성 (스텁)**

Create `src/app/api/slack/command/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { params } = result;
  const command = params.get("command");

  // 커맨드 라우팅 (Task 7에서 구현)
  if (command === "/문자") {
    // Task 7에서 구현
    return NextResponse.json({ text: "준비 중입니다" });
  }

  return NextResponse.json({ text: `알 수 없는 커맨드: ${command}` });
}
```

Create `src/app/api/slack/action/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { payload } = result;
  if (!payload) return NextResponse.json({ error: "No payload" }, { status: 400 });

  // view_submission (모달 submit) — Task 9에서 구현
  // block_actions (버튼 클릭) — Task 10에서 구현

  return NextResponse.json({ ok: true });
}
```

Create `src/app/api/slack/event/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  // URL verification challenge
  const { body } = result;
  const parsed = JSON.parse(body);
  if (parsed.type === "url_verification") {
    return NextResponse.json({ challenge: parsed.challenge });
  }

  return NextResponse.json({ ok: true });
}
```

Create `src/app/api/slack/options/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { payload } = result;
  if (!payload) return NextResponse.json({ options: [] });

  // external_select 검색 — Task 8에서 구현
  return NextResponse.json({ options: [] });
}
```

- [ ] **Step 9: 커밋**

```bash
git add src/lib/slack/verify.ts src/lib/slack/client.ts \
  src/lib/slack/__tests__/verify.test.ts \
  src/app/api/slack/ package.json pnpm-lock.yaml
git commit -m "feat: Slack 서명 검증 + WebClient 싱글톤 + API Route 스텁"
```

---

## Task 7: /문자 커맨드 → 모달 오픈

**Files:**
- Create: `src/lib/slack/commands/sms.ts`
- Modify: `src/app/api/slack/command/route.ts`

- [ ] **Step 1: 모달 빌더 함수 작성**

Create `src/lib/slack/commands/sms.ts`:

```typescript
import { getSlackClient } from "../client";

/**
 * /문자 커맨드 핸들러 — SMS 발송 모달을 연다.
 */
export async function handleSmsCommand(triggerId: string) {
  const client = getSlackClient();

  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "sms_send_modal",
      title: {
        type: "plain_text",
        text: "문자 보내기",
      },
      submit: {
        type: "plain_text",
        text: "전송",
      },
      close: {
        type: "plain_text",
        text: "취소",
      },
      blocks: [
        {
          type: "input",
          block_id: "recipient_block",
          label: {
            type: "plain_text",
            text: "받는 사람",
          },
          element: {
            type: "external_select",
            action_id: "contact_select",
            placeholder: {
              type: "plain_text",
              text: "이름 또는 번호 검색...",
            },
            min_query_length: 1,
          },
        },
        {
          type: "input",
          block_id: "message_block",
          label: {
            type: "plain_text",
            text: "내용",
          },
          element: {
            type: "plain_text_input",
            action_id: "message_input",
            multiline: true,
            placeholder: {
              type: "plain_text",
              text: "문자 내용을 입력하세요",
            },
          },
        },
      ],
    },
  });
}
```

- [ ] **Step 2: command route에 핸들러 연결**

`src/app/api/slack/command/route.ts`를 수정:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";
import { handleSmsCommand } from "@/lib/slack/commands/sms";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { params } = result;
  const command = params.get("command");
  const triggerId = params.get("trigger_id");

  if (command === "/문자" && triggerId) {
    await handleSmsCommand(triggerId);
    return new NextResponse(null, { status: 200 });
  }

  return NextResponse.json({ text: `알 수 없는 커맨드: ${command}` });
}
```

- [ ] **Step 3: 빌드 확인**

```bash
pnpm build
```

Expected: 빌드 성공 (standalone 출력)

- [ ] **Step 4: 커밋**

```bash
git add src/lib/slack/commands/sms.ts src/app/api/slack/command/route.ts
git commit -m "feat: /문자 슬래시 커맨드 → 모달 오픈"
```

---

## Task 8: 연락처 라이브 검색 (external_select)

**Files:**
- Create: `src/lib/slack/options/contacts.ts`
- Modify: `src/app/api/slack/options/route.ts`

- [ ] **Step 1: 검색 핸들러 작성**

Create `src/lib/slack/options/contacts.ts`:

```typescript
import { prisma } from "@/lib/db/prisma";
import { formatPhoneNumber, normalizePhoneNumber } from "@/lib/utils/phone";

const DIRECT_INPUT_VALUE = "__direct_input__";

export { DIRECT_INPUT_VALUE };

/**
 * external_select 옵션 검색 핸들러.
 * 쿼리로 연락처를 검색하고, "직접 입력" 옵션도 함께 반환.
 */
export async function searchContacts(query: string) {
  if (!query.trim()) {
    return { options: [] };
  }

  const contacts = await prisma.contact.findMany({
    where: {
      OR: [
        { name: { contains: query } },
        { phoneNumber: { contains: query } },
      ],
    },
    take: 10,
    orderBy: { name: "asc" },
  });

  const options = contacts.map((c) => ({
    text: {
      type: "plain_text" as const,
      text: `${c.name} (${formatPhoneNumber(c.phoneNumber)})`,
    },
    value: c.phoneNumber,
  }));

  // "직접 입력" 옵션 추가
  const normalized = normalizePhoneNumber(query);
  const directInputLabel = normalized
    ? `직접 입력: ${formatPhoneNumber(normalized)}`
    : `직접 입력: ${query}`;

  options.push({
    text: {
      type: "plain_text",
      text: directInputLabel,
    },
    value: normalized ?? DIRECT_INPUT_VALUE,
  });

  return { options };
}
```

- [ ] **Step 2: options route에 핸들러 연결**

`src/app/api/slack/options/route.ts`를 수정:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";
import { searchContacts } from "@/lib/slack/options/contacts";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { payload } = result;
  if (!payload) return NextResponse.json({ options: [] });

  const query = payload.value ?? "";
  const searchResult = await searchContacts(query);

  return NextResponse.json(searchResult);
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/lib/slack/options/contacts.ts src/app/api/slack/options/route.ts
git commit -m "feat: 연락처 라이브 검색 (external_select)"
```

---

## Task 9: SMS 발신 (모달 submit) + 중복 방지

**Files:**
- Create: `src/lib/slack/actions/sms-send.ts`
- Create: `src/lib/slack/messages/sms-sent.ts`
- Create: `src/lib/slack/messages/__tests__/sms-sent.test.ts`
- Modify: `src/app/api/slack/action/route.ts`

- [ ] **Step 1: 발신 메시지 포맷 테스트 작성**

Create `src/lib/slack/messages/__tests__/sms-sent.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildSmsSentMessage } from "../sms-sent";

describe("buildSmsSentMessage", () => {
  it("발신 메시지 Block Kit 포맷 생성", () => {
    const result = buildSmsSentMessage({
      recipientName: "김철수 (010-1234-5678)",
      phoneNumber: "+821012345678",
      message: "내일 배송 예정입니다",
      senderUserId: "U123",
      gatewayMessageId: "msg-456",
    });

    expect(result.text).toBe("SMS 발신: 김철수 (010-1234-5678)");
    expect(result.blocks).toHaveLength(4);
    expect(result.blocks[0].text.text).toContain("<@U123>");
    expect(result.blocks[2].text.text).toBe("내일 배송 예정입니다");
  });
});
```

- [ ] **Step 2: 발신 메시지 포맷 구현**

Create `src/lib/slack/messages/sms-sent.ts`:

```typescript
interface SmsSentMessageParams {
  recipientName: string;
  phoneNumber: string;
  message: string;
  senderUserId: string;
  gatewayMessageId: string;
}

export function buildSmsSentMessage(params: SmsSentMessageParams) {
  return {
    text: `SMS 발신: ${params.recipientName}`,
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: `*SMS 발신*\n수신: ${params.recipientName}\n발신자: <@${params.senderUserId}>`,
        },
      },
      { type: "divider" as const },
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: params.message,
        },
      },
      {
        type: "context" as const,
        elements: [
          {
            type: "mrkdwn" as const,
            text: `ID: ${params.gatewayMessageId} | ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
          },
        ],
      },
    ],
  };
}

/**
 * SMS 발송 실패 시 재시도 버튼 포함 메시지
 */
export function buildSmsFailedMessage(params: {
  recipientName: string;
  phoneNumber: string;
  message: string;
  error: string;
}) {
  return {
    text: `SMS 발송 실패: ${params.recipientName}`,
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: `*SMS 발송 실패*\n수신: ${params.recipientName}\n에러: ${params.error}`,
        },
      },
      {
        type: "actions" as const,
        elements: [
          {
            type: "button" as const,
            text: { type: "plain_text" as const, text: "재시도" },
            action_id: "retry_sms",
            value: JSON.stringify({
              phoneNumber: params.phoneNumber,
              message: params.message,
            }),
            style: "danger" as const,
          },
        ],
      },
    ],
  };
}
```

- [ ] **Step 3: 테스트 실행 확인**

```bash
pnpm test src/lib/slack/messages/__tests__/sms-sent.test.ts
```

Expected: PASS

- [ ] **Step 4: SMS 발신 핸들러 작성**

Create `src/lib/slack/actions/sms-send.ts`:

```typescript
import { getEnv } from "@/lib/config/env";
import { getSmsGatewayClient } from "@/lib/sms-gateway/client";
import { getSlackClient } from "@/lib/slack/client";
import { prisma } from "@/lib/db/prisma";
import { normalizePhoneNumber, formatPhoneNumber } from "@/lib/utils/phone";
import { buildSmsSentMessage, buildSmsFailedMessage } from "../messages/sms-sent";
import { logger } from "@/lib/logger";

/**
 * sms_send_modal view_submission 핸들러.
 * 모달 submit → SMS 발송 → 슬랙 채널 포스팅 → DB 기록.
 */
export async function handleSmsSendSubmission(payload: any) {
  const view = payload.view;
  const userId = payload.user.id;
  const slackActionId = `view_${view.id}`;

  // 중복 전송 방지: unique constraint로 보장
  // race condition 대비: create 시 unique 에러 catch
  const recipientValue =
    view.state?.values?.recipient_block?.contact_select?.selected_option?.value
    ?? (view.private_metadata ? JSON.parse(view.private_metadata).phoneNumber : null);

  const messageText =
    view.state?.values?.message_block?.message_input?.value;

  if (!recipientValue || !messageText) {
    return {
      response_action: "errors",
      errors: {
        ...(!recipientValue && { recipient_block: "받는 사람을 선택하세요" }),
        ...(!messageText && { message_block: "내용을 입력하세요" }),
      },
    };
  }

  const phoneNumber = normalizePhoneNumber(recipientValue);
  if (!phoneNumber) {
    return {
      response_action: "errors",
      errors: { recipient_block: "유효하지 않은 전화번호입니다" },
    };
  }

  // 연락처 매칭
  const contact = await prisma.contact.findUnique({
    where: { phoneNumber },
  });
  const recipientName = contact
    ? `${contact.name} (${formatPhoneNumber(phoneNumber)})`
    : formatPhoneNumber(phoneNumber);

  const env = getEnv();
  const slackClient = getSlackClient();

  try {
    // SMS 발송
    const smsClient = getSmsGatewayClient();
    const result = await smsClient.sendSMS(phoneNumber, messageText);

    // DB 기록 (unique constraint로 중복 방지)
    try {
      await prisma.messageLog.create({
        data: {
          direction: "outbound",
          phoneNumber,
          message: messageText,
          status: "sent",
          slackActionId,
          contactId: contact?.id,
        },
      });
    } catch (dbError: any) {
      // unique constraint 위반 = 이미 처리됨 (race condition)
      if (dbError?.code === "P2002") {
        logger.info({ slackActionId }, "중복 전송 방지됨");
        return null;
      }
      throw dbError;
    }

    // 슬랙 채널에 발신 기록
    await slackClient.chat.postMessage({
      channel: env.SLACK_CHANNEL_CS_SMS,
      ...buildSmsSentMessage({
        recipientName,
        phoneNumber,
        message: messageText,
        senderUserId: userId,
        gatewayMessageId: result.id,
      }),
    });

    logger.info({ phoneNumber, gatewayId: result.id }, "SMS 발신 성공");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ phoneNumber, error: errorMsg }, "SMS 발신 실패");

    // 실패 시 재시도 버튼 포함 알림
    await slackClient.chat.postMessage({
      channel: env.SLACK_CHANNEL_CS_SMS,
      ...buildSmsFailedMessage({
        recipientName,
        phoneNumber,
        message: messageText,
        error: errorMsg,
      }),
    });

    await prisma.messageLog.create({
      data: {
        direction: "outbound",
        phoneNumber,
        message: messageText,
        status: "failed",
        slackActionId: `${slackActionId}_failed`,
        contactId: contact?.id,
      },
    });
  }

  return null; // 모달 닫기
}
```

- [ ] **Step 5: action route에 핸들러 연결**

`src/app/api/slack/action/route.ts`를 수정:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";
import { handleSmsSendSubmission } from "@/lib/slack/actions/sms-send";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { payload } = result;
  if (!payload) return NextResponse.json({ error: "No payload" }, { status: 400 });

  // view_submission (모달 submit)
  if (payload.type === "view_submission") {
    const callbackId = payload.view?.callback_id;

    if (callbackId === "sms_send_modal") {
      const response = await handleSmsSendSubmission(payload);
      if (response) return NextResponse.json(response);
      return new NextResponse(null, { status: 200 });
    }
  }

  // block_actions (버튼 클릭) — Task 10에서 reply_sms, retry_sms 추가

  return new NextResponse(null, { status: 200 });
}
```

- [ ] **Step 6: 커밋**

```bash
git add src/lib/slack/actions/sms-send.ts src/lib/slack/messages/sms-sent.ts \
  src/lib/slack/messages/__tests__/sms-sent.test.ts \
  src/app/api/slack/action/route.ts
git commit -m "feat: SMS 발신 (모달 submit) + 중복 전송 방지 + 재시도 버튼"
```

---

## Task 10: SMS 수신 웹훅 + 슬랙 알림 + 답장/재시도 버튼

**Files:**
- Create: `src/app/api/webhook/sms/route.ts`
- Create: `src/lib/slack/messages/sms-received.ts`
- Create: `src/lib/slack/messages/__tests__/sms-received.test.ts`
- Create: `src/lib/slack/actions/reply-sms.ts`
- Modify: `src/app/api/slack/action/route.ts`

- [ ] **Step 1: 수신 메시지 포맷 테스트 작성**

Create `src/lib/slack/messages/__tests__/sms-received.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildSmsReceivedMessage } from "../sms-received";

describe("buildSmsReceivedMessage", () => {
  it("연락처 매칭 시 이름 표시", () => {
    const result = buildSmsReceivedMessage({
      senderName: "김철수",
      phoneNumber: "+821098765432",
      message: "목대 가능합니다",
      receivedAt: "2026-03-18T14:30:00Z",
    });
    expect(result.text).toContain("김철수");
    expect(result.blocks[0].text.text).toContain("김철수");
    expect(result.blocks[0].text.text).toContain("010-9876-5432");
  });

  it("연락처 미매칭 시 번호만 표시", () => {
    const result = buildSmsReceivedMessage({
      senderName: null,
      phoneNumber: "+821011112222",
      message: "테스트",
      receivedAt: "2026-03-18T14:30:00Z",
    });
    expect(result.text).toContain("010-1111-2222");
  });

  it("답장하기 버튼 포함", () => {
    const result = buildSmsReceivedMessage({
      senderName: null,
      phoneNumber: "+821012345678",
      message: "테스트",
      receivedAt: "2026-03-18T14:30:00Z",
    });
    const actionsBlock = result.blocks.find((b: any) => b.type === "actions");
    expect(actionsBlock).toBeTruthy();
    expect(actionsBlock.elements[0].action_id).toBe("reply_sms");
  });
});
```

- [ ] **Step 2: 수신 메시지 포맷 구현**

Create `src/lib/slack/messages/sms-received.ts`:

```typescript
import { formatPhoneNumber } from "@/lib/utils/phone";

interface SmsReceivedMessageParams {
  senderName: string | null;
  phoneNumber: string;
  message: string;
  receivedAt: string;
}

export function buildSmsReceivedMessage(params: SmsReceivedMessageParams) {
  const displayName = params.senderName
    ? `${params.senderName} (${formatPhoneNumber(params.phoneNumber)})`
    : formatPhoneNumber(params.phoneNumber);

  const time = new Date(params.receivedAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
  });

  return {
    text: `SMS 수신: ${displayName}`,
    blocks: [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: `*SMS 수신*\n발신: ${displayName}\n시간: ${time}`,
        },
      },
      { type: "divider" as const },
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: params.message,
        },
      },
      {
        type: "actions" as const,
        elements: [
          {
            type: "button" as const,
            text: { type: "plain_text" as const, text: "답장하기" },
            action_id: "reply_sms",
            value: params.phoneNumber,
            style: "primary" as const,
          },
        ],
      },
    ],
  };
}
```

- [ ] **Step 3: 테스트 실행 확인**

```bash
pnpm test src/lib/slack/messages/__tests__/sms-received.test.ts
```

Expected: PASS

- [ ] **Step 4: SMS 수신 웹훅 route 작성**

Create `src/app/api/webhook/sms/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getSmsGatewayClient } from "@/lib/sms-gateway/client";
import { getEnv } from "@/lib/config/env";
import { getSlackClient } from "@/lib/slack/client";
import { prisma } from "@/lib/db/prisma";
import { normalizePhoneNumber } from "@/lib/utils/phone";
import { buildSmsReceivedMessage } from "@/lib/slack/messages/sms-received";
import { logger } from "@/lib/logger";
import type { SmsGatewayWebhookEvent } from "@/lib/sms-gateway/types";

export async function POST(request: NextRequest) {
  const body = await request.text();

  // HMAC 서명 검증
  const signature = request.headers.get("x-signature") ?? "";
  const smsClient = getSmsGatewayClient();

  if (!smsClient.verifyWebhookSignature(signature, body)) {
    logger.warn({ signature }, "SMS 웹훅 서명 검증 실패");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event: SmsGatewayWebhookEvent = JSON.parse(body);

  if (event.event !== "sms:received") {
    return NextResponse.json({ ok: true });
  }

  const { phoneNumber: rawPhone, message, receivedAt } = event.payload;
  const phoneNumber = normalizePhoneNumber(rawPhone) ?? rawPhone;

  // 연락처 매칭
  const contact = await prisma.contact.findUnique({
    where: { phoneNumber },
  });

  // 메시지 로그 저장
  const log = await prisma.messageLog.create({
    data: {
      direction: "inbound",
      phoneNumber,
      message,
      status: "received",
      contactId: contact?.id,
    },
  });

  // 슬랙 알림
  const env = getEnv();
  const slackClient = getSlackClient();

  const slackMessage = buildSmsReceivedMessage({
    senderName: contact?.name ?? null,
    phoneNumber,
    message,
    receivedAt,
  });

  const postResult = await slackClient.chat.postMessage({
    channel: env.SLACK_CHANNEL_CS_SMS,
    ...slackMessage,
  });

  // 슬랙 메시지 ts 저장
  if (postResult.ts) {
    await prisma.messageLog.update({
      where: { id: log.id },
      data: { slackMessageTs: postResult.ts },
    });
  }

  logger.info({ phoneNumber, contactName: contact?.name }, "SMS 수신 처리 완료");
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: 답장하기 + 재시도 버튼 핸들러 작성**

Create `src/lib/slack/actions/reply-sms.ts`:

```typescript
import { getSlackClient } from "@/lib/slack/client";
import { prisma } from "@/lib/db/prisma";
import { formatPhoneNumber, normalizePhoneNumber } from "@/lib/utils/phone";
import { getSmsGatewayClient } from "@/lib/sms-gateway/client";
import { getEnv } from "@/lib/config/env";
import { buildSmsSentMessage } from "@/lib/slack/messages/sms-sent";
import { logger } from "@/lib/logger";

/**
 * [답장하기] 버튼 → SMS 발송 모달 오픈 (수신자 미리 채움)
 */
export async function handleReplySms(payload: any) {
  const action = payload.actions?.[0];
  const phoneNumber = action?.value;
  const triggerId = payload.trigger_id;

  if (!phoneNumber || !triggerId) return;

  const contact = await prisma.contact.findUnique({
    where: { phoneNumber },
  });

  const displayName = contact
    ? `${contact.name} (${formatPhoneNumber(phoneNumber)})`
    : formatPhoneNumber(phoneNumber);

  const slackClient = getSlackClient();

  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "sms_send_modal",
      private_metadata: JSON.stringify({ phoneNumber }),
      title: { type: "plain_text", text: "답장하기" },
      submit: { type: "plain_text", text: "전송" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*받는 사람:* ${displayName}`,
          },
        },
        {
          type: "input",
          block_id: "message_block",
          label: { type: "plain_text", text: "내용" },
          element: {
            type: "plain_text_input",
            action_id: "message_input",
            multiline: true,
          },
        },
      ],
    },
  });
}

/**
 * [재시도] 버튼 → SMS 재발송
 */
export async function handleRetrySms(payload: any) {
  const action = payload.actions?.[0];
  if (!action?.value) return;

  const { phoneNumber, message } = JSON.parse(action.value);
  const normalized = normalizePhoneNumber(phoneNumber);
  if (!normalized) return;

  const env = getEnv();
  const slackClient = getSlackClient();
  const smsClient = getSmsGatewayClient();

  try {
    const result = await smsClient.sendSMS(normalized, message);

    const contact = await prisma.contact.findUnique({
      where: { phoneNumber: normalized },
    });

    await prisma.messageLog.create({
      data: {
        direction: "outbound",
        phoneNumber: normalized,
        message,
        status: "sent",
        contactId: contact?.id,
      },
    });

    const recipientName = contact
      ? `${contact.name} (${formatPhoneNumber(normalized)})`
      : formatPhoneNumber(normalized);

    await slackClient.chat.postMessage({
      channel: env.SLACK_CHANNEL_CS_SMS,
      ...buildSmsSentMessage({
        recipientName,
        phoneNumber: normalized,
        message,
        senderUserId: payload.user.id,
        gatewayMessageId: result.id,
      }),
    });

    logger.info({ phoneNumber: normalized }, "SMS 재시도 발신 성공");
  } catch (error) {
    logger.error({ phoneNumber: normalized, error }, "SMS 재시도 발신 실패");
  }
}
```

- [ ] **Step 6: action route에 답장/재시도 핸들러 연결**

`src/app/api/slack/action/route.ts`의 block_actions 부분에 추가:

```typescript
import { handleReplySms, handleRetrySms } from "@/lib/slack/actions/reply-sms";

// 기존 코드의 // block_actions 주석 부분을 교체:
if (payload.type === "block_actions") {
  const actionId = payload.actions?.[0]?.action_id;

  if (actionId === "reply_sms") {
    await handleReplySms(payload);
    return new NextResponse(null, { status: 200 });
  }

  if (actionId === "retry_sms") {
    await handleRetrySms(payload);
    return new NextResponse(null, { status: 200 });
  }
}
```

- [ ] **Step 7: 커밋**

```bash
git add src/app/api/webhook/sms/route.ts \
  src/lib/slack/messages/sms-received.ts \
  src/lib/slack/messages/__tests__/sms-received.test.ts \
  src/lib/slack/actions/reply-sms.ts \
  src/app/api/slack/action/route.ts
git commit -m "feat: SMS 수신 웹훅 + 슬랙 알림 + 답장/재시도 버튼"
```

---

## Task 11: 헬스체크 + 로깅

**Files:**
- Create: `src/app/api/health/route.ts`
- Modify: `package.json` (pino 추가)
- Create: `src/lib/logger.ts`

- [ ] **Step 1: pino 설치**

```bash
pnpm add pino
```

- [ ] **Step 2: `src/lib/logger.ts` 작성**

```typescript
import pino from "pino";

export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino/file", options: { destination: 1 } }
      : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
```

- [ ] **Step 3: `src/app/api/health/route.ts` 작성**

```typescript
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
    mysql: "error" as const,
    smsGateway: "error" as const,
  };

  // MySQL 체크
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.mysql = "ok";
  } catch {
    // 에러 유지
  }

  // SMS Gateway 체크
  try {
    const smsGatewayUrl = process.env.SMS_GATEWAY_URL ?? "http://sms-gateway:3080";
    const res = await fetch(`${smsGatewayUrl}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      checks.smsGateway = "ok";
    }
  } catch {
    // 에러 유지
  }

  const allOk = Object.values(checks).every((v) => v === "ok");

  const health: HealthStatus = {
    status: allOk ? "ok" : "error",
    checks,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(health, {
    status: allOk ? 200 : 503,
  });
}
```

- [ ] **Step 4: SMS Gateway 클라이언트에 logger 추가**

`src/lib/sms-gateway/client.ts`의 `sendSMS`에서 에러 시 로깅:

```typescript
import { logger } from "@/lib/logger";

// sendSMS의 if (!response.ok) 블록에 추가:
logger.error({ phoneNumber, status: response.status }, "SMS 발송 실패");
```

> **참고:** Task 10에서 작성한 웹훅 route와 액션 핸들러에는 이미 logger가 포함되어 있다.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/logger.ts src/app/api/health/route.ts \
  src/lib/sms-gateway/client.ts package.json pnpm-lock.yaml
git commit -m "feat: 헬스체크 엔드포인트 + pino 구조화 로깅"
```

---

## Task 12: 최종 검증 + 빌드

- [ ] **Step 1: 전체 테스트 실행**

```bash
pnpm test
```

Expected: 모든 테스트 PASS

- [ ] **Step 2: 린트**

```bash
pnpm lint
```

Expected: 에러 없음

- [ ] **Step 3: 빌드**

```bash
pnpm build
```

Expected: standalone 출력 성공 (`.next/standalone/` 생성)

- [ ] **Step 4: Docker 빌드 테스트**

```bash
docker compose build app
```

Expected: 멀티스테이지 빌드 성공

- [ ] **Step 5: Docker Compose 전체 기동 테스트**

```bash
docker compose up -d
# 잠시 대기 후 헬스체크
curl http://localhost/api/health
```

Expected: `{"status":"ok","checks":{"mysql":"ok","smsGateway":"ok"},...}`

- [ ] **Step 6: 커밋 (lint/빌드 수정 사항이 있는 경우)**

```bash
git add -A
git commit -m "fix: 빌드 + 린트 수정"
```

---

## 태스크 요약

| Task | 내용 | 예상 파일 수 |
|------|------|-------------|
| 1 | Docker 인프라 (Dockerfile, compose, nginx) | 7 |
| 2 | 환경변수 검증 + 공통 타입 | 2 |
| 3 | Prisma 스키마 + 시드 데이터 | 4 |
| 4 | 전화번호 정규화 유틸 (TDD) | 2 |
| 5 | SMS Gateway 클라이언트 (TDD) | 3 |
| 6 | Slack 서명 검증 + WebClient + API Routes (TDD) | 8 |
| 7 | /문자 커맨드 → 모달 | 2 |
| 8 | 연락처 라이브 검색 | 2 |
| 9 | SMS 발신 + 중복 방지 + 재시도 버튼 (TDD) | 4 |
| 10 | SMS 수신 웹훅 + 알림 + 답장/재시도 (TDD) | 5 |
| 11 | 헬스체크 + 로깅 | 2 |
| 12 | 최종 검증 + 빌드 | 0 |

### 추후 개선 항목 (1단계 범위 밖)

- nginx HTTPS (443) server block + certbot 설정
- SMS Gateway / CS폰 오프라인 감지 → 슬랙 경고 알림
- "고객카드 보기" 버튼 (CS 툴 API 필요)
- `direct_phone_input_modal` 완성 (부모 모달 값 갱신 — Slack 제약으로 현재는 직접 번호를 검색창에 입력하는 것으로 대체)
