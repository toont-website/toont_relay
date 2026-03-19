# Slack SMS UX 개선 설계

## 목표

CS팀이 사용하는 Slack SMS 채널의 가독성 및 사용성을 개선한다. 스레드 기반 대화 관리, 수신/발신 메시지 시각적 구분, 답장 시 대화 맥락 제공.

## 핵심 요구사항

1. **스레드 기반 대화** — 같은 번호의 메시지를 하나의 스레드로 묶음
2. **5일 룰** — 마지막 메시지로부터 5일 초과 시 새 스레드 생성
3. **수신/발신 시각 구분** — 색상 사이드바 + 아이콘으로 방향 구분
4. **미등록 번호 경고** — 미등록 번호는 노란색 + 경고 표시 + "연락처 등록" 버튼
5. **답장 모달에 대화 맥락** — 최근 3개 메시지를 모달 상단에 표시
6. **멀티 유저** — 누가 답장했는지 @mention 표시

## 상세 설계

### 1. 메시지 레이아웃 (Block Kit + Attachments)

Slack에서 색상 사이드바는 `attachments` 배열로만 가능. `blocks`는 attachment 내부에 배치.

**API 구조:**
```typescript
await slackClient.chat.postMessage({
  channel: env.SLACK_CHANNEL_CS_SMS,
  text: "SMS 수신 — 홍길동 (010-1234-5678)", // fallback
  thread_ts: threadTs, // 스레드 답글 시
  attachments: [{
    color: "#36C759",
    blocks: [
      // Section, Divider, Context, Actions ...
    ],
  }],
});
```

#### 1-1. 수신 메시지 — 새 문의 (스레드 부모)

채널에 새로 뜨는 메시지. 이 메시지가 스레드의 시작점.

```
attachment color: #36C759 (초록)

Section (mrkdwn):
  *📩 새 문의* — *홍길동* (010-1234-5678)

Divider

Section (mrkdwn):
  배송 언제 되나요?

Context:
  📅 2026. 3. 19. 오후 6:30

Actions:
  [답장하기] (primary)
```

#### 1-2. 수신 메시지 — 이어지는 대화 (스레드 답글)

기존 스레드에 답글로 달리는 수신 메시지.

```
attachment color: #36C759 (초록)

Section (mrkdwn):
  *📩 고객*

Divider

Section (mrkdwn):
  감사합니다

Context:
  📅 2026. 3. 19. 오후 6:35

Actions:
  [답장하기] (primary)
```

#### 1-3. 수신 메시지 — 미등록 번호

```
attachment color: #FFB800 (노란)

Section (mrkdwn):
  *📩 새 문의* — *⚠️ 미등록 번호* (010-9999-8888)

Divider

Section (mrkdwn):
  여기 영업시간이 어떻게 되나요?

Context:
  📅 2026. 3. 19. 오후 7:00

Actions:
  [답장하기] (primary)  [연락처 등록]
```

#### 1-4. 발신 메시지 (스레드 답글)

```
attachment color: #2196F3 (파란)

Section (mrkdwn):
  *📤 발신* — <@U12345|강동현> → 홍길동

Divider

Section (mrkdwn):
  내일 출발합니다

Context:
  📅 2026. 3. 19. 오후 6:32
```

#### 1-5. 발신 실패 메시지

```
attachment color: #FF3B30 (빨강)

Section (mrkdwn):
  *❌ 발송 실패* — 홍길동 (010-1234-5678)
  에러: SMS 발송 실패: 503 Service Unavailable

Section (mrkdwn):
  내일 출발합니다

Actions:
  [재시도] (danger)
```

### 2. 스레드 관리 로직

#### 2-1. 스레드 검색 및 판단

SMS 수신 시:

1. `messageLog`에서 같은 `phoneNumber`의 가장 최근 메시지 조회 (direction 무관)
2. `slackThreadTs`가 있는 가장 최근 레코드를 찾음
3. 해당 레코드의 `createdAt`으로 5일 룰 판단

```sql
SELECT slackThreadTs, createdAt
FROM MessageLog
WHERE phoneNumber = ?
  AND slackThreadTs IS NOT NULL
ORDER BY createdAt DESC
LIMIT 1
```

#### 2-2. 5일 룰 판단

```
결과 없음 → 새 스레드
결과 있음:
  현재 시각 - createdAt > 5일 → 새 스레드
  현재 시각 - createdAt ≤ 5일 → 기존 스레드에 답글 (thread_ts = slackThreadTs)
```

#### 2-3. slackThreadTs 저장 시점

**새 스레드 (채널 직게시):**
```typescript
const postResult = await slackClient.chat.postMessage({ channel, attachments });
// postResult.ts = 이 메시지의 ts = 스레드 부모
await prisma.messageLog.update({
  where: { id: log.id },
  data: {
    slackMessageTs: postResult.ts,
    slackThreadTs: postResult.ts,  // 자기 자신이 부모
  },
});
```

**기존 스레드에 답글:**
```typescript
const activeThreadTs = found.slackThreadTs; // DB에서 찾은 스레드 부모 ts
const postResult = await slackClient.chat.postMessage({
  channel,
  thread_ts: activeThreadTs,
  attachments,
});
await prisma.messageLog.update({
  where: { id: log.id },
  data: {
    slackMessageTs: postResult.ts,
    slackThreadTs: activeThreadTs,  // 부모의 ts 그대로
  },
});
```

#### 2-4. 동시성 처리

같은 번호로 동시에 메시지가 2개 수신되는 경우:
- **허용**: 둘 다 같은 스레드에 답글로 게시되거나, 둘 다 새 스레드를 만들 수 있음
- 이 케이스는 실제로 드물고, 발생해도 사용자 경험에 큰 영향 없음
- DB 트랜잭션/락은 불필요한 복잡도

#### 2-5. DB 스키마 변경

`MessageLog`에 `slackThreadTs` 필드 추가:

```prisma
model MessageLog {
  // 기존 필드...
  slackMessageTs String?  // 이 메시지의 Slack ts
  slackThreadTs  String?  // 이 메시지가 속한 스레드의 부모 ts (추가)
}
```

마이그레이션:
```sql
ALTER TABLE MessageLog ADD COLUMN slackThreadTs VARCHAR(191) NULL;
CREATE INDEX idx_messagelog_thread ON MessageLog (phoneNumber, slackThreadTs, createdAt);
```

### 3. 답장 모달 개선

#### 3-1. reply_sms 버튼 value 변경

현재 버튼 value는 `phoneNumber`만 전달. `threadTs`도 포함하도록 JSON으로 변경:

```typescript
// sms-received.ts 메시지 빌더
{
  type: "button",
  text: { type: "plain_text", text: "답장하기" },
  action_id: "reply_sms",
  style: "primary",
  value: JSON.stringify({
    phoneNumber: params.phoneNumber,
    threadTs: params.threadTs,
  }),
}
```

`SmsReceivedMessageParams`에 `threadTs: string` 필드 추가.

#### 3-2. handleReplySms에서 대화 맥락 + threadTs 전달

```typescript
export async function handleReplySms(payload: any) {
  const action = payload.actions?.[0];
  const { phoneNumber, threadTs } = JSON.parse(action.value);

  // 최근 3개 메시지 조회
  const recentMessages = await prisma.messageLog.findMany({
    where: { phoneNumber, slackThreadTs: threadTs },
    orderBy: { createdAt: "desc" },
    take: 3,
    include: { contact: true },
  });

  // 모달에 대화 맥락 블록 + 메시지 입력 표시
  // private_metadata에 phoneNumber + threadTs 포함
  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "sms_send_modal",
      private_metadata: JSON.stringify({ phoneNumber, threadTs }),
      // ... blocks with recent messages + input
    },
  });
}
```

#### 3-3. 모달 Block Kit 구조

```
┌─ 답장하기 — 홍길동 (010-1234-5678) ──┐
│                                       │
│  Section: *최근 대화*                  │
│                                       │
│  Context: 📩 고객 (오후 6:35)          │
│           "감사합니다"                  │
│                                       │
│  Context: 📤 @강동현 (오후 6:32)       │
│           "내일 출발합니다"              │
│                                       │
│  Context: 📩 고객 (오후 6:30)          │
│           "배송 언제 되나요?"            │
│                                       │
│  Divider                              │
│                                       │
│  Input: message_block (multiline)     │
│                                       │
│                            [전송]     │
└───────────────────────────────────────┘
```

### 4. 발신 메시지의 스레드 연동

#### 4-1. executeSmsSend에서 스레드 답글로 게시

`private_metadata`에서 `threadTs`를 읽어서 `chat.postMessage`에 `thread_ts`로 전달:

```typescript
const { phoneNumber, threadTs } = JSON.parse(view.private_metadata);

// threadTs가 있으면 스레드 답글, 없으면 채널에 직접 게시
await slackClient.chat.postMessage({
  channel: env.SLACK_CHANNEL_CS_SMS,
  thread_ts: threadTs || undefined,
  attachments: [{ color: "#2196F3", blocks: [...] }],
});
```

#### 4-2. handleRetrySms 스레드 연동

재시도 버튼의 value에도 `threadTs` 포함:

```typescript
// sms-sent.ts (실패 메시지 빌더)
value: JSON.stringify({ phoneNumber, message, threadTs })

// reply-sms.ts (handleRetrySms)
const { phoneNumber, message, threadTs } = JSON.parse(action.value);
await slackClient.chat.postMessage({
  channel: env.SLACK_CHANNEL_CS_SMS,
  thread_ts: threadTs || undefined,
  ...buildSmsSentMessage({...}),
});
```

#### 4-3. /sms 인라인 발신

`/sms 홍길동 안녕하세요` 같은 인라인 발신 시:
1. 해당 번호의 활성 스레드 검색 (5일 룰)
2. 활성 스레드 있으면 → 스레드에 답글
3. 없으면 → 채널에 직접 게시 (새 스레드 시작은 수신 시에만)

### 5. 연락처 등록 버튼

#### 5-1. 액션 핸들러

action_id: `register_contact`
modal callback_id: `register_contact_modal`

미등록 번호의 "연락처 등록" 버튼 클릭 시:

```typescript
// register-contact.ts
export async function handleRegisterContact(payload: any) {
  const { phoneNumber } = JSON.parse(payload.actions[0].value);

  await slackClient.views.open({
    trigger_id: payload.trigger_id,
    view: {
      type: "modal",
      callback_id: "register_contact_modal",
      private_metadata: JSON.stringify({ phoneNumber }),
      title: { type: "plain_text", text: "연락처 등록" },
      submit: { type: "plain_text", text: "등록" },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*전화번호:* ${formatPhoneNumber(phoneNumber)}` },
        },
        {
          type: "input",
          block_id: "name_block",
          label: { type: "plain_text", text: "이름" },
          element: { type: "plain_text_input", action_id: "name_input" },
        },
        {
          type: "input",
          block_id: "memo_block",
          label: { type: "plain_text", text: "메모" },
          optional: true,
          element: { type: "plain_text_input", action_id: "memo_input" },
        },
      ],
    },
  });
}
```

#### 5-2. view_submission 처리

```typescript
// route.ts에 추가
if (callbackId === "register_contact_modal") {
  const { phoneNumber } = JSON.parse(payload.view.private_metadata);
  const name = payload.view.state.values.name_block.name_input.value;
  const memo = payload.view.state.values.memo_block?.memo_input?.value;

  await prisma.contact.create({
    data: { phoneNumber, name, memo },
  });

  return new NextResponse(null, { status: 200 });
}
```

## 변경 대상 파일

| 파일 | 변경 | 설명 |
|------|------|------|
| `prisma/schema.prisma` | Modify | slackThreadTs 필드 추가 |
| `prisma/migrations/` | Create | slackThreadTs 마이그레이션 |
| `src/lib/slack/messages/sms-received.ts` | Rewrite | attachment 기반 레이아웃 + threadTs 파라미터 |
| `src/lib/slack/messages/sms-sent.ts` | Rewrite | attachment 기반 레이아웃 + threadTs 파라미터 |
| `src/lib/slack/thread/find-thread.ts` | Create | 스레드 검색 + 5일 룰 로직 |
| `src/app/api/webhook/sms/route.ts` | Modify | 스레드 로직 연동 + slackThreadTs 저장 |
| `src/lib/slack/actions/reply-sms.ts` | Modify | 대화 맥락 표시 + threadTs 전달 + handleRetrySms 스레드 연동 |
| `src/lib/slack/actions/sms-send.ts` | Modify | 발신 시 스레드 답글로 게시 |
| `src/lib/slack/actions/register-contact.ts` | Create | 연락처 등록 액션 핸들러 |
| `src/lib/slack/commands/sms.ts` | Modify | 인라인 발신도 스레드 연동 |
| `src/app/api/slack/action/route.ts` | Modify | register_contact + register_contact_modal 추가 |

## 제외 사항

- 읽음 확인 / 상태 표시: 현재 불필요
- 메시지 검색: Slack 기본 검색으로 충분
- 대시보드/통계: 별도 프로젝트로 분리
