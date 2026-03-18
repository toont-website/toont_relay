# 경유서버 + SMS Gateway + 슬랙봇 인프라 설계

> 작성일: 2026-03-18
> 상태: Approved
> 스코프: 1단계 — 슬랙 채널에서 SMS 수신/발신 체크

---

## 1. 스코프

### 지금 만들 것 (1단계)

- 경유서버 (Next.js) + SMS Gateway 프라이빗 서버 + 슬랙봇 인프라 구성
- `/문자` 슬래시 커맨드로 SMS 발신 (모달 + 연락처 라이브 검색)
- SMS 수신 시 `#CS-문자` 슬랙 채널에 알림
- 연락처 + 메시지 로그 DB (MySQL + Prisma, SMS Gateway와 DB 공유)

### 나중에 할 것

- CS폰 연결 (android-sms-gateway 앱 설치)
- CS 툴 API 개방 후 연락처 데이터 마이그레이션
- 나머지 슬래시 커맨드 (`/재고`, `/발주`, `/배차` 등)
- 쇼핑몰 웹훅 연동
- 구글캘린더 연동
- 품질/하자 관리 시스템

---

## 2. 전체 인프라 구조

### 배포 환경

- GCE VM 1대 (e2-small or e2-medium)
- Docker Compose로 전체 관리

### Docker Compose 구성

```
GCE VM (e2-small ~$15/월)
│
├── docker-compose.yml
│   ├── app (Next.js 경유서버)
│   │   ├── port: 3000
│   │   ├── 역할: 슬랙봇 + SMS 연동 + 웹훅 처리
│   │   └── SMS Gateway랑 내부 네트워크 통신
│   │
│   ├── sms-gateway (android-sms-gateway 프라이빗 서버)
│   │   ├── port: 3080 (내부)
│   │   ├── 역할: CS폰 연결, SMS 발신/수신 큐
│   │   └── 웹훅으로 수신 SMS를 app 컨테이너에 전달
│   │
│   ├── mysql (공유 DB)
│   │   ├── port: 3306 (내부만)
│   │   ├── DB: sms_gateway (SMS Gateway용)
│   │   └── DB: toont_relay (경유서버용 — 연락처, 메시지 로그)
│   │
│   └── nginx (리버스 프록시)
│       ├── port: 80, 443 (외부)
│       ├── SSL (Let's Encrypt / certbot)
│       ├── /api/* → app:3000 (/api/webhook/sms는 외부 차단)
│       └── /sms-gateway/* → sms-gateway:3080 (CS폰 연결용, SMS Gateway 자체 인증)
```

### 네트워크 통신

- Next.js <-> SMS Gateway: Docker 내부 네트워크 (`http://sms-gateway:3080`)
- 외부 트래픽: 전부 nginx가 수신
- MySQL: 외부 노출 안 함
- SMS Gateway 웹훅: `http://app:3000/api/webhook/sms` (내부, nginx 안 거침)

---

## 3. Next.js 프로젝트 구조

```
src/
├── app/
│   ├── api/
│   │   ├── slack/
│   │   │   ├── command/route.ts     ← 슬래시 커맨드 (/문자 등)
│   │   │   ├── action/route.ts      ← 버튼 클릭, 모달 submit
│   │   │   ├── event/route.ts       ← 이벤트 구독
│   │   │   └── options/route.ts     ← external_select 검색 요청
│   │   ├── webhook/
│   │   │   └── sms/route.ts         ← SMS Gateway 웹훅 수신
│   │   └── sms/
│   │       └── send/route.ts        ← SMS 발송 요청
│   ├── layout.tsx
│   ├── page.tsx                     ← 나중에 대시보드 (지금 안 건드림)
│   └── globals.css
│
├── lib/
│   ├── slack/
│   │   ├── app.ts                   ← Bolt App 인스턴스 (싱글톤)
│   │   ├── commands/
│   │   │   └── sms.ts               ← /문자 커맨드 핸들러
│   │   ├── actions/
│   │   │   └── sms-send.ts          ← 모달 submit + 답장 버튼
│   │   ├── options/
│   │   │   └── contacts.ts          ← 연락처 라이브 검색
│   │   └── messages/
│   │       └── sms-received.ts      ← SMS 수신 알림 Block Kit 포맷
│   │
│   ├── sms-gateway/
│   │   ├── client.ts                ← SMS Gateway REST API 클라이언트
│   │   └── types.ts                 ← API 타입 정의
│   │
│   ├── db/
│   │   └── prisma.ts                ← Prisma 클라이언트 싱글톤
│   │
│   ├── utils/
│   │   └── phone.ts                 ← 전화번호 정규화 (E.164)
│   │
│   └── config/
│       └── env.ts                   ← 환경변수 zod 검증
│
├── types/
│   └── index.ts                     ← 공통 타입
│
└── prisma/
    └── schema.prisma                ← 연락처 + 메시지 로그 스키마
```

---

## 4. 슬랙봇 설계

### Slack App 설정

| 설정 항목 | 값 |
|-----------|-----|
| Request URL (Slash Commands) | `https://{도메인}/api/slack/command` |
| Request URL (Interactivity) | `https://{도메인}/api/slack/action` |
| Request URL (Options Load) | `https://{도메인}/api/slack/options` |
| Event Subscriptions URL | `https://{도메인}/api/slack/event` |
| Bot Token Scopes | `chat:write`, `commands`, `channels:read`, `users:read` |

### SDK

- Slack Bolt for JavaScript (HTTP mode)
- Next.js API Route에서 Bolt 인스턴스 사용
- **주의**: Next.js 16 App Router의 `route.ts`는 `Request` 객체를 받음. Bolt 서명 검증에 raw body가 필요하므로 `request.text()`로 원문을 보존한 뒤 Bolt에 전달해야 함
- 라우팅: 각 API route에서 Bolt 싱글톤 인스턴스의 해당 처리 메서드를 호출하는 구조

### 1단계 기능

#### /문자 커맨드 (SMS 발신)

```
/문자 입력
  → 모달 오픈
  ┌──────────────────────────────┐
  │ 문자 보내기                     │
  │                              │
  │ 받는 사람                      │
  │ [external_select 라이브 검색]   │
  │  - 고객명/전화번호 둘 다 검색    │
  │  - 매칭 없으면 "직접 입력" 옵션  │
  │                              │
  │ 내용                          │
  │ [텍스트 입력]                   │
  │                              │
  │        [취소]  [전송]          │
  └──────────────────────────────┘
```

- `external_select` 타입으로 서버(`/api/slack/options`)에 검색 요청
- 고객명 + 번호 함께 표시 (예: "김철수 (010-1234-5678)")
- 등록 안 된 번호: "직접 입력" 옵션 선택 → `views.push`로 두 번째 모달 오픈 → `plain_text_input`으로 전화번호 직접 입력

#### SMS 수신 알림

```
┌─────────────────────────────────┐
│ SMS 수신                         │
│ 발신: 김철수 (010-9876-5432)     │  ← 연락처 매칭 시 이름 표시
│ 시간: 2026-03-18 14:30          │
│ ────────────────────────        │
│ 목대 600mm 10개 금요일까지 가능합니다 │
│                                 │
│ [답장하기]  [고객카드 보기]         │
└─────────────────────────────────┘
```

- [답장하기] → 모달 → SMS 발신
- 연락처 DB 조회로 발신번호 → 고객명 매칭
- 매칭 안 되면 번호만 표시

---

## 5. SMS Gateway 연동

### SMS 발신 플로우

```
슬랙 /문자 → 모달 전송
  → /api/slack/action (모달 submit)
  → lib/sms-gateway/client.ts
  → POST http://sms-gateway:3080/3rdparty/v1/message
    { "message": "...", "phoneNumbers": ["+82..."] }
  → SMS Gateway → CS폰에서 실제 SMS 발송
  → 슬랙 #CS-문자 채널에 발신 기록 포스팅
  → MessageLog DB에 발신 기록 저장
```

### SMS 중복 전송 방지

- 슬랙은 3초 내 응답 없으면 재시도함 (`x-slack-retry-num` 헤더)
- 모달 submit 시 `x-slack-retry-num > 0`이면 무시 (이미 처리 중)
- 추가로 MessageLog에 `slackActionId`를 저장해 멱등성 보장

### SMS 수신 플로우

```
CS폰 SMS 수신
  → SMS Gateway 앱 → 프라이빗 서버
  → 프라이빗 서버 웹훅
  → POST http://app:3000/api/webhook/sms
    {
      "event": "sms:received",
      "payload": {
        "phoneNumber": "+8201098765432",
        "message": "...",
        "receivedAt": "2026-03-18T14:30:00Z"
      }
    }
  → HMAC-SHA256 서명 검증
  → 연락처 DB에서 발신번호로 고객명 조회
  → 슬랙 #CS-문자 채널에 수신 알림 포스팅
```

### API 클라이언트 (`lib/sms-gateway/client.ts`)

- `sendSMS(phoneNumber, message)` — 발신
- `getMessageStatus(messageId)` — 발송 상태 확인
- `verifyWebhookSignature(headers, body)` — 웹훅 HMAC 검증
- JWT Bearer Token 인증

### 에러 처리

- SMS 발송 실패 → 슬랙에 실패 알림 + 재시도 버튼
- 웹훅 서명 검증 실패 → 무시 + 로그
- CS폰 오프라인 → SMS Gateway가 큐에 쌓고 복귀 시 발송

---

## 6. 데이터베이스

### MySQL + Prisma (SMS Gateway와 DB 인스턴스 공유)

- SMS Gateway가 이미 MySQL을 쓰므로, 같은 MySQL 인스턴스에 별도 DB(`toont_relay`) 생성
- SQLite Docker 볼륨 손실 위험 제거

```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

model Contact {
  id          String       @id @default(cuid())
  name        String
  phoneNumber String       @unique  // E.164 형식: +821012345678
  memo        String?
  messages    MessageLog[]
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
}

model MessageLog {
  id             String   @id @default(cuid())
  direction      String   // "inbound" | "outbound"
  phoneNumber    String   // E.164 형식
  message        String   @db.Text
  status         String   // "sent" | "delivered" | "failed" | "received"
  slackActionId  String?  @unique  // 중복 전송 방지용
  slackMessageTs String?  // 슬랙 메시지 permalink용
  contact        Contact? @relation(fields: [contactId], references: [id])
  contactId      String?
  createdAt      DateTime @default(now())
}
```

### 전화번호 정규화

- 저장/비교 시 E.164 형식 통일: `+821012345678`
- 입력 시 `010-1234-5678`, `01012345678`, `+821012345678` 모두 허용 → 정규화 함수에서 변환
- `lib/utils/phone.ts`에 `normalizePhoneNumber()` 유틸리티

### TODO

- **CS 툴 API 개방 후 연락처 데이터를 CS 툴로 마이그레이션할 것**

---

## 7. 환경변수

```env
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_CHANNEL_CS_SMS=C0XXXXXX

# SMS Gateway
SMS_GATEWAY_URL=http://sms-gateway:3080
SMS_GATEWAY_JWT_TOKEN=...
SMS_GATEWAY_WEBHOOK_SECRET=...

# Database (MySQL - SMS Gateway와 같은 인스턴스)
DATABASE_URL=mysql://toont:password@mysql:3306/toont_relay

# App
NODE_ENV=production
APP_URL=https://relay.toont.co.kr
```

- `lib/config/env.ts`에서 zod로 전부 검증
- 빠진 환경변수 있으면 서버 시작 시 즉시 에러

---

## 8. 보안

- 슬랙 요청: Bolt SDK가 signing secret 자동 검증
- SMS Gateway 웹훅: HMAC-SHA256 서명 수동 검증 (내부 네트워크지만 defense-in-depth)
- SMS Gateway API: JWT Bearer Token 인증
- MySQL: 외부 노출 차단 (Docker 내부만)
- nginx: SSL (Let's Encrypt)
- nginx: `/api/webhook/sms` 외부 접근 차단 (내부 Docker 네트워크에서만 허용)
- nginx: `/sms-gateway/*` — SMS Gateway 자체 인증에 의존 (CS폰 앱 연결)
- nginx: SMS 발송 관련 엔드포인트 rate limiting (분당 30회)
- 환경변수: `.env` 파일 gitignore

---

## 9. 로깅 & 모니터링

- 구조화된 JSON 로깅 (pino)
- SMS 발신/수신 모든 이벤트 로그 기록
- `/api/health` 헬스체크 엔드포인트 (app + sms-gateway + mysql 상태)
- Docker Compose `healthcheck` 디렉티브 각 서비스에 설정
- SMS Gateway / CS폰 오프라인 감지 → `#CS-문자` 채널에 경고 알림

---

## 10. Docker 빌드

- Next.js `output: 'standalone'` 모드로 빌드
- 멀티스테이지 Dockerfile (deps → build → runner)
- 베이스 이미지: `node:20-alpine`

---

## 11. 구현 우선순위 (1단계 내부)

| 순서 | 작업 | 이유 |
|------|------|------|
| 1 | Docker Compose + nginx 세팅 | 인프라 기반 |
| 2 | SMS Gateway 프라이빗 서버 구동 | SMS 연동 기반 |
| 3 | Next.js API 기본 구조 + 환경변수 검증 | 앱 기반 |
| 4 | Prisma + 연락처 스키마 + 시드 데이터 | 라이브 검색 기반 |
| 5 | 슬랙 앱 생성 + Bolt SDK 세팅 | 슬랙봇 기반 |
| 6 | SMS Gateway API 클라이언트 | 발신/수신 기반 |
| 7 | /문자 커맨드 + 모달 + 라이브 검색 | 발신 기능 |
| 8 | SMS 수신 웹훅 + 슬랙 알림 | 수신 기능 |
| 9 | 에러 처리 + 재시도 + 중복 전송 방지 | 안정성 |
| 10 | 헬스체크 + 로깅 | 운영 |
