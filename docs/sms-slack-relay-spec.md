# SMS-Slack Relay 오픈소스 명세서

> TOONT Relay 경유서버를 기반으로 한 **Android SMS Gateway ↔ Slack** 양방향 릴레이 시스템 명세.
> 새 프로젝트를 만들 때 이 문서를 레퍼런스로 사용.

---

## 1. 시스템 개요

Android 폰에서 수신한 SMS를 자동으로 Slack 채널에 릴레이하고, Slack에서 답장을 보내면 해당 폰을 통해 SMS를 발송하는 **양방향 SMS-Slack 브릿지**.

### 핵심 기능

| 기능 | 설명 |
|------|------|
| SMS 수신 → Slack | 폰에 도착한 SMS를 Slack 채널에 자동 포스팅 |
| Slack → SMS 발송 | Slack slash command / 모달을 통해 SMS 발송 |
| 연락처 관리 | 전화번호 ↔ 이름 매핑, Slack에서 CRUD |
| 스레드 관리 | 같은 번호와의 대화를 Slack 스레드로 묶음 (5일 TTL) |
| 중복 방지 | 30초 이내 동일 메시지 필터링 + slackActionId unique |
| 담당자 멘션 | 마지막 답장한 담당자에게 자동 @멘션 |
| 헬스체크 | DB, SMS Gateway, 폰 기기 연결 상태 모니터링 |

---

## 2. 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Compose                        │
│                                                          │
│  ┌──────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │  nginx   │──▶│  app (relay) │──▶│  sms-backend    │  │
│  │ (reverse │   │  Next.js     │   │  (ASG Server)   │  │
│  │  proxy)  │   │  port:3000   │   │  port:3080      │  │
│  │ 80/443   │   └──────┬───────┘   └────────┬────────┘  │
│  └──────────┘          │                     │           │
│                        │            ┌────────┴────────┐  │
│                        ▼            │  sms-worker     │  │
│                   ┌─────────┐      │  (백그라운드)     │  │
│                   │  MySQL  │◀─────┘                    │
│                   │  8.0    │                           │
│                   └─────────┘                           │
└─────────────────────────────────────────────────────────┘
         ▲                              ▲
         │ HTTPS                        │ WebSocket/Polling
         │                              │
    ┌────┴────┐                    ┌────┴────┐
    │  Slack  │                    │ Android │
    │  API    │                    │  폰 앱  │
    └─────────┘                    └─────────┘
```

### 컨테이너 구성

| 서비스 | 이미지 | 역할 | 포트 |
|--------|--------|------|------|
| `app` | 커스텀 Dockerfile (Next.js) | Slack ↔ SMS 릴레이 엔진 | 3000 (내부) |
| `sms-backend` | `ghcr.io/android-sms-gateway/server:latest` | SMS API 서버 | 3080 (내부) |
| `sms-worker` | `ghcr.io/android-sms-gateway/server:latest` | 백그라운드 작업 처리 | - |
| `mysql` | `mysql:8.0` | relay + SMS Gateway 공용 DB | 3306 (내부) |
| `nginx` | `nginx:alpine` | 리버스 프록시 + SSL | 80, 443 |

---

## 3. Android SMS Gateway (ASG) 연동

### 3.1 ASG란?

[Android SMS Gateway](https://github.com/android-sms-gateway/server)는 Android 폰을 SMS 송수신 게이트웨이로 만들어주는 오픈소스 프로젝트. 폰에 앱을 설치하면 HTTP API로 SMS를 주고받을 수 있다.

### 3.2 구성 요소

```
[Android 폰 앱] ←── WebSocket/Polling ──→ [ASG Server (sms-backend)]
                                              │
                                    HTTP API (Basic Auth)
                                              │
                                         [Relay App]
```

- **ASG Server**: Docker로 실행, SMS 송수신 API 제공
- **ASG Worker**: 백그라운드 메시지 처리 (같은 이미지, `worker` 커맨드)
- **Android 앱**: 폰에 설치, private token으로 서버에 연결

### 3.3 ASG Server 설정 (docker-compose 내 config)

```yaml
gateway:
  mode: private                              # private 모드 (토큰 인증)
  webhooks:
    - url: http://app:3000/api/webhook/sms   # SMS 수신 시 relay 앱으로 웹훅
      event: sms:received
http:
  listen: 0.0.0.0:3080                       # API 리슨 포트
database:
  host: mysql
  port: 3306
  user: smsgateway
  password: smsgateway_password
  database: sms_gateway                      # relay 앱과 별도 DB
fcm:
  credentials_json: "{}"                     # FCM 미사용 시 빈 값
  timeout_seconds: 1
  debounce_seconds: 5
```

### 3.4 인증 방식

**API 호출 (relay → ASG):** Basic Auth

```typescript
const basicAuth = Buffer.from(`${username}:${password}`).toString("base64");

fetch(`${SMS_GATEWAY_URL}/api/3rdparty/v1/message`, {
  method: "POST",
  headers: {
    Authorization: `Basic ${basicAuth}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ message, phoneNumbers: [phoneNumber] }),
});
```

**폰 앱 연결:** Private Token

```
ASG_GATEWAY_PRIVATE_TOKEN=<openssl rand -hex 32 로 생성>
```

폰 앱 설정 화면에서 서버 URL + 이 토큰을 입력하면 연결됨.

**웹훅 서명 (ASG → relay):** HMAC-SHA256

```typescript
// 검증 로직
const expected = createHmac("sha256", webhookSecret)
  .update(body + timestamp)   // body 문자열 + timestamp 문자열 연결
  .digest("hex");

// 헤더
// x-signature: hex 인코딩된 HMAC
// x-timestamp: Unix timestamp 문자열
```

### 3.5 API 엔드포인트

| Method | Endpoint | 용도 | Request Body | Response |
|--------|----------|------|-------------|----------|
| `POST` | `/api/3rdparty/v1/message` | SMS 발송 | `{ message, phoneNumbers[] }` | `{ id, state, message, phoneNumbers, createdAt }` |
| `GET` | `/api/3rdparty/v1/message/{id}` | 발송 상태 조회 | - | `{ id, state }` |
| `GET` | `/api/3rdparty/v1/device` | 연결된 기기 목록 | - | `[{ id, name, lastSeen, createdAt, deletedAt }]` |

### 3.6 SMS 상태 흐름

```
아웃바운드: Pending → Processed → Sent → Delivered (또는 Failed)
인바운드:   sms:received 웹훅으로 즉시 수신
```

### 3.7 웹훅 이벤트

```typescript
interface SmsGatewayWebhookEvent {
  event: "sms:received" | "sms:sent" | "sms:delivered" | "sms:failed";
  payload: {
    id: string;
    phoneNumber: string;   // 발신자 번호
    message: string;       // 메시지 내용
    receivedAt: string;    // ISO8601
  };
  webhookId: string;       // 이벤트 고유 ID
}
```

---

## 4. 환경변수 관리

### 4.1 전체 환경변수 목록

```bash
# ──────────────────────────────────────
# Slack
# ──────────────────────────────────────
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
  # Slack 봇 토큰. Slack App → OAuth & Permissions에서 발급.
  # 필요 권한: chat:write, commands, files:read

SLACK_SIGNING_SECRET=your-signing-secret-here
  # Slack 요청 서명 검증용. Slack App → Basic Information에서 확인.

SLACK_CHANNEL_CS_SMS=C0000000000
  # SMS 릴레이 메시지가 올라갈 Slack 채널 ID.
  # 채널 우클릭 → "채널 세부정보 보기" → 맨 아래 ID 확인.

# ──────────────────────────────────────
# SMS Gateway (Android SMS Gateway)
# ──────────────────────────────────────
SMS_GATEWAY_URL=http://sms-backend:3080
  # ASG 서버 내부 주소. Docker 네트워크 내 서비스명:포트.

SMS_GATEWAY_USERNAME=your-username-here
SMS_GATEWAY_PASSWORD=your-password-here
  # 폰 앱 연결 후 자동 생성되는 Basic Auth 크레덴셜.
  # ASG 서버 로그 또는 DB에서 확인 가능.

SMS_GATEWAY_WEBHOOK_SECRET=your-webhook-secret-here
  # 웹훅 HMAC 서명 검증용 시크릿.
  # 폰 앱 Settings → Webhooks → Signing Key 에서 확인.

ASG_GATEWAY_PRIVATE_TOKEN=your-private-token-here
  # 폰 앱 ↔ ASG 서버 연결용 토큰.
  # openssl rand -hex 32 로 직접 생성.

# ──────────────────────────────────────
# Database
# ──────────────────────────────────────
DATABASE_URL=mysql://toont:toont_password@mysql:3306/toont_relay
  # Relay 앱용 MySQL 연결 문자열.
  # ASG 서버는 별도 DB(sms_gateway)를 사용.

MYSQL_ROOT_PASSWORD=your-mysql-root-password-here
  # MySQL root 비밀번호. docker-compose에서 사용.

# ──────────────────────────────────────
# App
# ──────────────────────────────────────
NODE_ENV=production
APP_URL=https://your-domain.com
  # 외부 접근 가능한 서버 주소. SSL 필수 (Slack 웹훅 요구사항).

# ──────────────────────────────────────
# Health Check
# ──────────────────────────────────────
CRON_SECRET=your-cron-secret-here
  # 크론 엔드포인트 인증 토큰.

HEALTH_CHECK_DEVICE_THRESHOLD_MINUTES=30
  # 기기 연결 끊김 판단 임계값 (분). 기본 30분.
```

### 4.2 Zod 런타임 검증 패턴

```typescript
import { z } from "zod";

const envSchema = z.object({
  SLACK_BOT_TOKEN: z.string().startsWith("xoxb-"),
  SLACK_SIGNING_SECRET: z.string().min(1),
  SLACK_CHANNEL_CS_SMS: z.string().startsWith("C"),
  SMS_GATEWAY_URL: z.string().url(),
  SMS_GATEWAY_USERNAME: z.string().min(1),
  SMS_GATEWAY_PASSWORD: z.string().min(1),
  SMS_GATEWAY_WEBHOOK_SECRET: z.string().min(1),
  DATABASE_URL: z.string().startsWith("mysql://"),
  APP_URL: z.string().url(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CRON_SECRET: z.string().min(1),
  HEALTH_CHECK_DEVICE_THRESHOLD_MINUTES: z.coerce.number().int().min(1).default(30),
});

// 앱 시작 시 검증 — 잘못된 환경변수면 즉시 크래시
function validateEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`환경변수 검증 실패:\n${formatted}`);
  }
  return result.data;
}

// 싱글톤 패턴으로 캐싱
let _env: z.infer<typeof envSchema> | null = null;
export function getEnv() {
  if (!_env) _env = validateEnv();
  return _env;
}
```

### 4.3 환경변수 관리 원칙

- `.env.example`은 레포에 포함 (값은 placeholder)
- `.env`는 `.gitignore`에 반드시 추가
- Docker 서비스별로 필요한 변수만 전달 (`env_file` 또는 `environment`)
- Zod 스키마로 **앱 시작 시** 즉시 검증 — 런타임 에러 방지

---

## 5. 데이터베이스 스키마

### 5.1 ERD

```
┌─────────────────┐         ┌──────────────────────────┐
│    Contact       │         │      MessageLog           │
├─────────────────┤    1:N  ├──────────────────────────┤
│ id (CUID, PK)   │────────▶│ id (CUID, PK)            │
│ name             │         │ direction (inbound/out)   │
│ phoneNumber (UQ) │         │ phoneNumber (E.164)       │
│ memo?            │         │ message (TEXT)             │
│ createdAt        │         │ status                    │
│ updatedAt        │         │ slackActionId? (UQ)       │
└─────────────────┘         │ slackMessageTs?            │
                            │ slackThreadTs?             │
                            │ slackUserId?               │
                            │ contactId? (FK)            │
                            │ createdAt                  │
                            └──────────────────────────┘

┌─────────────────────┐
│   HealthCheckLog     │
├─────────────────────┤
│ id (CUID, PK)        │
│ mysqlStatus           │
│ gatewayStatus         │
│ deviceStatus          │
│ deviceLastSeen?       │
│ alertSent             │
│ createdAt             │
└─────────────────────┘
```

### 5.2 Prisma Schema

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
  phoneNumber String       @unique  // E.164: +821012345678
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
  slackActionId  String?  @unique   // idempotency key
  slackMessageTs String?
  slackThreadTs  String?
  slackUserId    String?
  contact        Contact? @relation(fields: [contactId], references: [id])
  contactId      String?
  createdAt      DateTime @default(now())

  @@index([phoneNumber])
  @@index([direction])
  @@index([createdAt])
  @@index([phoneNumber, slackThreadTs, createdAt])
}

model HealthCheckLog {
  id             String    @id @default(cuid())
  mysqlStatus    String
  gatewayStatus  String
  deviceStatus   String
  deviceLastSeen DateTime?
  alertSent      Boolean   @default(false)
  createdAt      DateTime  @default(now())

  @@index([createdAt])
}
```

### 5.3 DB 초기화 (docker-compose init)

MySQL 컨테이너 시작 시 `docker/init-db.sql`로 relay 앱용 DB와 유저를 별도 생성:

```sql
CREATE DATABASE IF NOT EXISTS toont_relay;
CREATE USER IF NOT EXISTS 'toont'@'%' IDENTIFIED BY 'toont_password';
GRANT ALL PRIVILEGES ON toont_relay.* TO 'toont'@'%';

-- ASG는 sms_gateway DB를 자동 생성하므로 유저만 생성
CREATE USER IF NOT EXISTS 'smsgateway'@'%' IDENTIFIED BY 'smsgateway_password';
GRANT ALL PRIVILEGES ON sms_gateway.* TO 'smsgateway'@'%';

FLUSH PRIVILEGES;
```

---

## 6. API 라우트 구조

```
/api/
├── /health                    GET   — 시스템 헬스체크
├── /slack/
│   ├── /command               POST  — Slash command 진입점
│   ├── /action                POST  — 모달 제출 / 버튼 클릭
│   ├── /options               POST  — 동적 드롭다운 옵션
│   └── /event                 POST  — Slack 이벤트 구독
├── /webhook/
│   └── /sms                   POST  — ASG 웹훅 (SMS 수신)
└── /cron/
    └── /health-monitor        GET   — 주기적 헬스 모니터링
```

---

## 7. 메시지 흐름 상세

### 7.1 SMS 수신 → Slack 게시

```
1. [폰] SMS 수신 → ASG 앱이 감지
2. [ASG 앱] → [ASG Server] 메시지 포워딩
3. [ASG Server] → POST /api/webhook/sms (HMAC-SHA256 서명)
4. [Relay]
   a. x-signature, x-timestamp 헤더로 서명 검증
   b. event === "sms:received" 확인
   c. 전화번호 E.164 정규화
   d. 30초 이내 동일 (번호 + 내용) 중복 체크 → 중복이면 무시
   e. Contact 테이블에서 연락처 조회
   f. 활성 스레드 검색 (마지막 메시지 5일 이내)
   g. 마지막 발신 담당자 조회 (멘션용)
   h. MessageLog 기록 (status: "received")
   i. Slack 메시지 빌드 (블록 + 버튼)
   j. chat.postMessage (스레드 있으면 thread_ts 지정)
   k. MessageLog에 slackMessageTs, slackThreadTs 업데이트
5. [Slack] 채널에 메시지 표시 + 답장/등록 버튼
```

### 7.2 Slack → SMS 발송

```
1. [Slack 유저] /sms 010-1234-5678 안녕하세요
2. [Relay] POST /api/slack/command
   a. Slack 서명 검증
   b. 즉시 "⏳ 처리 중..." 응답 (3초 제한 회피)
   c. after() 콜백에서 비동기 처리:
      - 연락처 조회 또는 번호 검증
      - SmsGatewayClient.sendSMS() 호출
      - MessageLog 기록 (status: "sent")
      - Slack에 발송 결과 메시지 게시
      - response_url로 최종 결과 전송
3. [ASG Server] → [폰] SMS 발송 지시
4. [폰] 실제 SMS 발송
5. [ASG Server] → sms:delivered 또는 sms:failed 웹훅 (선택적 처리)
```

### 7.3 모달을 통한 SMS 발송

```
1. [Slack 유저] /sms (인자 없이) 또는 "답장하기" 버튼 클릭
2. [Relay] views.open() → SMS 발송 모달 표시
   - 연락처 드롭다운 (동적 검색: /api/slack/options)
   - 메시지 입력 필드
   - 선택 시 최근 대화 이력 표시
3. [Slack 유저] 모달 제출
4. [Relay] POST /api/slack/action (type: view_submission)
   a. callback_id === "sms_send_modal" 확인
   b. 입력 검증 (번호 유효성, 메시지 비어있지 않은지)
   c. SMS 발송 + DB 기록 + Slack 메시지 게시
```

---

## 8. Slack 통합 상세

### 8.1 필요한 Slack App 설정

**Bot Token Scopes:**
- `chat:write` — 메시지 게시
- `commands` — Slash command
- `users:read` — 유저 정보 조회

**Interactivity & Shortcuts:**
- Request URL: `https://{도메인}/api/slack/action`
- Options Load URL: `https://{도메인}/api/slack/options`

**Slash Commands:**
- `/sms` → `https://{도메인}/api/slack/command`
- `/contact` → `https://{도메인}/api/slack/command`

**Event Subscriptions:**
- Request URL: `https://{도메인}/api/slack/event`

### 8.2 요청 검증 패턴

모든 Slack 요청은 서명 검증 필수:

```typescript
function verifySlackSignature(
  signingSecret: string,
  signature: string,     // x-slack-signature 헤더
  timestamp: string,     // x-slack-request-timestamp 헤더
  body: string           // raw request body
): boolean {
  // 1. 타임스탬프 5분 이내 확인 (리플레이 공격 방지)
  const ts = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) return false;

  // 2. HMAC-SHA256 서명 생성
  const sigBasestring = `v0:${timestamp}:${body}`;
  const expected = "v0=" + createHmac("sha256", signingSecret)
    .update(sigBasestring)
    .digest("hex");

  // 3. timing-safe 비교
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

**Slack 재시도 무시:**
```typescript
const retryNum = request.headers.get("x-slack-retry-num");
if (retryNum && Number(retryNum) > 0) {
  return NextResponse.json({ ok: true }); // 즉시 200 반환
}
```

### 8.3 Deferred Response 패턴

Slack slash command는 **3초** 안에 응답해야 함. 무거운 작업은 이 패턴 사용:

```typescript
import { after } from "next/server";

export async function POST(request: NextRequest) {
  const { params } = await parseSlackRequest(request);
  const responseUrl = params.get("response_url")!;

  // 1. 즉시 응답 (3초 안에)
  after(async () => {
    // 2. 비동기로 무거운 작업 수행
    const result = await heavyOperation();

    // 3. response_url로 최종 결과 전송
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "in_channel",  // 또는 "ephemeral"
        text: result,
      }),
    });
  });

  return NextResponse.json({
    response_type: "ephemeral",
    text: "⏳ 처리 중...",
  });
}
```

### 8.4 메시지 포맷

**SMS 수신 메시지 (Block Kit):**
```
색상: 등록된 연락처 → #36C759 (초록), 미등록 → #FFB800 (주황)

📩 [이름] (010-1234-5678) 님으로부터 새로운 문의가 도착했어요!
──────────────
[메시지 본문]
📅 2026. 3. 23. 오후 2:30

[답장하기] [연락처 등록]  ← 미등록 번호일 때만 등록 버튼 표시
```

**SMS 발송 메시지:**
```
색상: #2196F3 (파랑)

📤 @user님이 [이름] (010-1234-5678)님에게 문자를 보냈어요.
──────────────
[메시지 본문]
📅 2026. 3. 23. 오후 2:30
```

**SMS 발송 실패:**
```
색상: #FF3B30 (빨강)

❌ [이름]님에게 문자 발송에 실패했어요.
사유: [에러 메시지]

[재시도]
```

### 8.5 스레드 관리

같은 전화번호와의 대화는 Slack 스레드로 묶음:

```typescript
const THREAD_EXPIRY_DAYS = 5;

async function findActiveThread(phoneNumber: string): Promise<string | null> {
  // 해당 번호의 가장 최근 메시지에서 slackThreadTs 가져옴
  const latest = await prisma.messageLog.findFirst({
    where: { phoneNumber, slackThreadTs: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { slackThreadTs: true, createdAt: true },
  });

  if (!latest?.slackThreadTs) return null;

  // 5일 지났으면 새 스레드
  const elapsed = Date.now() - latest.createdAt.getTime();
  if (elapsed > THREAD_EXPIRY_DAYS * 24 * 60 * 60 * 1000) return null;

  return latest.slackThreadTs;
}
```

---

## 9. 전화번호 정규화

모든 전화번호는 **E.164 형식** (`+821012345678`)으로 저장:

```typescript
function normalizePhoneNumber(input: string): string | null {
  const cleaned = input.replace(/[\s\-()]/g, "");

  // 이미 E.164
  if (/^\+82\d{9,10}$/.test(cleaned)) return cleaned;
  if (/^\+820\d{9,10}$/.test(cleaned)) return `+82${cleaned.slice(4)}`; // +820 중복 제거

  // 한국 로컬 (010, 011, 016, 017, 018, 019)
  if (/^01[0-9]\d{7,8}$/.test(cleaned)) return `+82${cleaned.slice(1)}`;

  return null;
}

// E.164 → 사람이 읽기 쉬운 형식
function formatPhoneNumber(e164: string): string {
  const local = "0" + e164.replace(/^\+82/, "");
  if (local.length === 11) return `${local.slice(0,3)}-${local.slice(3,7)}-${local.slice(7)}`;
  if (local.length === 10) return `${local.slice(0,3)}-${local.slice(3,6)}-${local.slice(6)}`;
  return local;
}
```

---

## 10. 보안

### 10.1 서명 검증 체크리스트

| 인바운드 소스 | 검증 방식 | 구현 |
|-------------|----------|------|
| Slack → Relay | `v0=<HMAC-SHA256(v0:ts:body, signing_secret)>` | `x-slack-signature` + `x-slack-request-timestamp` |
| ASG → Relay | `HMAC-SHA256(body+ts, webhook_secret)` | `x-signature` + `x-timestamp` |

### 10.2 보안 원칙

- 모든 외부 웹훅은 **서명 검증 필수** — 실패 시 401
- 타임스탬프 5분 제한으로 **리플레이 공격 방지**
- `timingSafeEqual`로 **타이밍 공격 방지**
- 환경변수에 시크릿 저장 — 코드에 하드코딩 금지
- 외부 포트 노출 최소화 — nginx만 80/443 노출, 나머지 내부 네트워크
- Slack 재시도 요청(`x-slack-retry-num > 0`) 즉시 200 반환

### 10.3 Docker 네트워크 격리

```yaml
networks:
  internal:
    driver: bridge
# 모든 서비스가 internal 네트워크만 사용
# nginx만 외부 포트(80, 443) 바인딩
```

---

## 11. 헬스체크

### 11.1 엔드포인트

`GET /api/health`

```json
{
  "status": "ok | degraded | error",
  "checks": {
    "mysql": "ok | error",
    "smsGateway": "ok | error",
    "device": "ok | stale | error"
  },
  "device": {
    "lastSeen": "2026-03-23T14:30:00Z",
    "minutesAgo": 5
  },
  "timestamp": "2026-03-23T14:35:00Z"
}
```

### 11.2 상태 판정

| 상태 | 조건 | HTTP |
|------|------|------|
| `ok` | 모든 체크 정상 | 200 |
| `degraded` | 일부 실패 (기기 stale 등) | 200 |
| `error` | mysql 또는 gateway 실패 | 503 |

### 11.3 기기 연결 모니터링

- `getDevice()` API로 `lastSeen` 확인
- `HEALTH_CHECK_DEVICE_THRESHOLD_MINUTES` (기본 30분) 초과 시 `stale`
- 크론으로 주기적 체크 → Slack 알림 채널에 경고

---

## 12. 기술 스택

| 카테고리 | 선택 | 이유 |
|---------|------|------|
| 런타임 | Next.js (App Router) | API Routes + SSR, 배포 편의성 |
| 언어 | TypeScript | 타입 안전성 |
| ORM | Prisma | MySQL 지원, 타입 자동 생성, 마이그레이션 |
| DB | MySQL 8.0 | ASG Server와 동일 DB 엔진 공유 |
| Slack SDK | @slack/web-api | 공식 SDK, Block Kit 지원 |
| 검증 | Zod | 환경변수 + 입력 검증 |
| 로깅 | Pino | 구조화 JSON 로그, 성능 |
| 컨테이너 | Docker Compose | 로컬 + 프로덕션 동일 구성 |
| SMS Gateway | Android SMS Gateway | 오픈소스, 셀프호스팅, Docker 지원 |
| 리버스 프록시 | Nginx | SSL 터미네이션, 경로 라우팅 |

---

## 13. 새 프로젝트 세팅 순서

```bash
# 1. 프로젝트 생성
npx create-next-app@latest sms-slack-relay --typescript --app --tailwind

# 2. 의존성 설치
cd sms-slack-relay
pnpm add @prisma/client @slack/web-api pino zod
pnpm add -D prisma tsx vitest

# 3. Prisma 초기화
npx prisma init --datasource-provider mysql

# 4. .env 설정
cp .env.example .env
# 환경변수 채우기

# 5. DB 마이그레이션
npx prisma migrate dev --name init

# 6. Docker Compose 실행
docker compose up -d

# 7. 폰 앱 설정
# - Android SMS Gateway 앱 설치
# - 서버 URL + Private Token 입력
# - 연결 확인

# 8. Slack App 설정
# - https://api.slack.com/apps에서 앱 생성
# - Bot Token Scopes 추가
# - Interactivity URL 설정
# - Slash Commands 등록
# - Event Subscriptions URL 설정
```

---

## 14. 오픈소스화 시 제거/분리할 것

현재 toont_relay에는 CS Tool(CRM) 연동이 포함되어 있는데, 오픈소스 버전에서는 **SMS ↔ Slack 코어만** 남기고 나머지는 제거:

| 포함 (코어) | 제거 (비즈니스 로직) |
|------------|-------------------|
| SMS 수신 → Slack 게시 | CS Tool 클라이언트 (`/lib/cs-tool/`) |
| Slack → SMS 발송 | 주문/재고/대시보드 커맨드 |
| 연락처 CRUD | CS Tool 웹훅 (`/api/webhook/cs-tool/`) |
| 스레드 관리 | 주문/재고/오퍼레이션 Slack 채널 |
| 헬스체크 | CS Tool 관련 환경변수 |
| 중복 방지 | — |
| 담당자 멘션 | — |

### 코어 환경변수 (오픈소스 버전)

```bash
# Slack
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_CHANNEL_CS_SMS=

# SMS Gateway
SMS_GATEWAY_URL=
SMS_GATEWAY_USERNAME=
SMS_GATEWAY_PASSWORD=
SMS_GATEWAY_WEBHOOK_SECRET=
ASG_GATEWAY_PRIVATE_TOKEN=

# Database
DATABASE_URL=
MYSQL_ROOT_PASSWORD=

# App
NODE_ENV=
APP_URL=

# Health Check
CRON_SECRET=
HEALTH_CHECK_DEVICE_THRESHOLD_MINUTES=30
```

### 코어 파일 구조

```
src/
├── app/
│   └── api/
│       ├── health/route.ts
│       ├── slack/
│       │   ├── command/route.ts     (/sms, /contact만)
│       │   ├── action/route.ts
│       │   ├── options/route.ts
│       │   └── event/route.ts
│       ├── webhook/
│       │   └── sms/route.ts
│       └── cron/
│           └── health-monitor/route.ts
├── lib/
│   ├── config/env.ts
│   ├── db/prisma.ts
│   ├── logger.ts
│   ├── sms-gateway/
│   │   ├── client.ts
│   │   └── types.ts
│   ├── slack/
│   │   ├── client.ts
│   │   ├── verify.ts
│   │   ├── deferred-response.ts
│   │   ├── commands/
│   │   │   ├── sms.ts
│   │   │   └── contact.ts
│   │   ├── messages/
│   │   │   ├── sms-received.ts
│   │   │   └── sms-sent.ts
│   │   ├── modals/
│   │   │   ├── sms-send.ts
│   │   │   └── contact-register.ts
│   │   ├── options/
│   │   │   └── contacts.ts
│   │   └── thread/
│   │       └── find-thread.ts
│   └── utils/
│       └── phone.ts
├── prisma/
│   └── schema.prisma
├── docker/
│   └── init-db.sql
├── nginx/
│   ├── nginx.conf
│   └── conf.d/default.conf
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── package.json
```

---

## 15. 확장 포인트

오픈소스 프로젝트에서 플러그인/훅으로 확장 가능한 포인트들:

| 확장 포인트 | 설명 | 예시 |
|------------|------|------|
| 메시지 수신 훅 | SMS 수신 시 커스텀 로직 | 자동 응답, 키워드 필터링 |
| 메시지 발송 전 훅 | SMS 발송 전 가공/검증 | 금칙어 필터, 발송 승인 |
| 알림 채널 확장 | Slack 외 다른 채널 | Discord, Telegram, Teams |
| 전화번호 정규화 | 한국 외 국가 지원 | 국가코드 자동 감지 |
| 외부 시스템 연동 | 웹훅 수신 시 외부 API 호출 | CRM, 티켓 시스템 |
| 인증 확장 | 멀티 디바이스, 멀티 번호 | 여러 폰 연결 |
