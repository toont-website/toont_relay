# Slack ↔ CS Tool 전면 연동 설계

**작성일**: 2026-03-24
**상태**: 확정

---

## 개요

toont_relay에서 CS Tool의 전체 기능을 슬랙으로 관리할 수 있도록 확장한다. 연락처를 내부 DB에서 CS Tool API로 완전 이관하고, 프로필/오퍼레이션/체크리스트/메시지 템플릿을 슬랙에서 조작 가능하게 한다.

### 핵심 원칙

- **Thin Relay**: relay는 순수 중개자. CS Tool API 호출 + 슬랙 UI 렌더링만 담당. 비즈니스 로직은 CS Tool에 위임
- **단일 데이터 소스**: CS Tool API가 유일한 데이터 소스. 로컬 상태는 MessageLog(SMS 스레드 추적)만 유지
- **기존 패턴 유지**: deferred response, `after()` 비동기 실행, `block_actions` 모달 동적 갱신 등 기존 구현 패턴 그대로 활용

---

## 아키텍처

### 데이터 흐름

```
[슬랙 유저]
  ↕ (슬래시 커맨드 / 모달 / 버튼)
[toont_relay (Next.js)]
  ├── CS Tool API ← 주문, 재고, 연락처, 프로필, 오퍼레이션, 체크리스트
  ├── SMS Gateway API ← 문자 발송/수신
  ├── MySQL (MessageLog, HealthCheckLog) ← SMS 스레드 추적, 헬스체크 로그
  └── Slack Web API ← 메시지/모달 발송
```

### DB 마이그레이션

1. MessageLog의 `contactId` FK 해제 + 컬럼 DROP (phoneNumber 기반 매칭으로 충분)
2. Contact 테이블 DROP
3. SMS 스레드 추적은 기존 MessageLog의 `phoneNumber` + `slackThreadTs` 조합으로 동작 (변경 없음)

> **데이터 보존 참고**: 기존 MessageLog 레코드의 연락처 정보는 `phoneNumber` 필드에 이미 저장되어 있으므로 `contactId` 제거 시 데이터 손실 없음. 연락처 이름이 필요한 경우 CS Tool API `GET /contacts?search={phoneNumber}`로 조회.

---

## 커맨드 전체 맵

### 기존 커맨드 변경

| 커맨드 | 변경 내용 |
|---|---|
| `/contact` | 내부 DB → CS Tool API 전환. 타입/주소 필드 추가. 수정 기능 추가 |
| `/order` | 주문 상세에 연락처+체크리스트+템플릿 버튼 풀 정보 표시 |
| `/order-add` | 프로필 선택 + 필수 연락처 타입별 배정 필드 동적 추가 |
| `/sms` | 연락처 검색을 CS Tool API로 변경 |
| `/stock`, `/stock-in`, `/stock-out` | 변경 없음 |
| `/dashboard` | 변경 없음 |

### 신규 커맨드

| 커맨드 | 동작 |
|---|---|
| `/contact-type` | 연락처 타입 CRUD |
| `/profile` | 프로필 조회/수정 |
| `/operation` | 칸반 뷰 + 단계 이동 + 체크리스트 |

---

## 1. 연락처 시스템

### `/contact` 커맨드

| 사용법 | 동작 | API |
|---|---|---|
| `/contact` | 전체 목록 (타입별 그룹핑) | `GET /contacts` |
| `/contact [검색어]` | 이름/번호 검색 | `GET /contacts?search={query}` |
| `/contact 추가` | 연락처 등록 모달 | `POST /contacts` |
| `/contact 삭제 [이름]` | 삭제 (확인 후) | `DELETE /contacts/{id}` |
| `/contact 수정 [이름]` | 수정 모달 | `PATCH /contacts/{id}` |

#### 등록 모달 필드

- 이름 (필수)
- 연락처 타입 (드롭다운 — `GET /contact-types`에서 동적 로드)
- 전화번호 (선택)
- 메모 (선택)
- 주소 (선택)

#### SMS 수신 플로우 변경

- 기존: `prisma.contact.findUnique({ phoneNumber })` → 등록 여부 판단
- 변경: `GET /contacts?search={phoneNumber}` → 등록 여부 판단
- 나머지(스레드 추적, 메시지 포맷) 동일

#### SMS 모달 연락처 드롭다운

- 기존: `prisma.contact.findMany({ name contains query })`
- 변경: `GET /contacts?search={query}`
- 검색 결과 없을 시: 기존 패턴 유지 — "직접 입력: {번호}" 옵션 표시. 주문 등록 모달의 연락처 드롭다운도 동일

### `/contact-type` 커맨드 (신규)

| 사용법 | 동작 | API |
|---|---|---|
| `/contact-type` | 타입 목록 | `GET /contact-types` |
| `/contact-type 추가 [이름] [slug]` | 타입 추가 | `POST /contact-types` |
| `/contact-type 삭제 [이름]` | 타입 삭제 (기본 타입 불가) | `DELETE /contact-types/{id}` |

---

## 2. 주문 시스템

### `/order` 조회 변경

| 사용법 | 동작 | API |
|---|---|---|
| `/order` | 최근 주문 목록 | `GET /orders` |
| `/order [검색어]` | 고객명/상태 검색 | `GET /orders?customer={query}` 또는 상태 필터 |
| `/order [주문ID]` | 주문 상세 (풀 정보) | `GET /orders/{id}` |

### 주문 상세 메시지

한 메시지에 전체 정보 표시:

- 기본 정보 (고객, 상품, 수량, 상태, 납기일, 프로필)
- 현재 단계 + 진행률 + 마감일
- 배정 연락처 목록 (타입별, 미배정 표시)
- 체크리스트 상태
- 메시지 템플릿

#### 버튼 액션

| 버튼 | 동작 |
|---|---|
| 연락처 배정 | 필수 타입 중 미배정 항목에 대해 연락처 검색/배정 모달 |
| 체크리스트 작성 | 현재 단계 체크리스트 항목 처리 모달 |
| 📋 복사 | 템플릿 텍스트를 ephemeral 메시지로 전송 (복사용) |
| 📨 보내기 | 컨펌 모달 → SMS 발송 |

### `/order-add` 모달 변경

#### 흐름

1. 모달 오픈 → 기본 필드 (고객명, 전화번호, 상품 드롭다운, 수량, 배송지, 납기일, 메모, 구매경로)
2. 상품(SKU) 선택 시 → 프로필 매칭
   - 프로필 1개: 자동 선택 (표시만)
   - 프로필 2개+: 드롭다운으로 선택
   - 프로필 없음: 기본 프로필 적용
3. 프로필 확정 시 → `requiredContactTypes`에 따라 연락처 입력 필드 동적 추가
   - 각 타입별 `external_select` (기존 연락처 검색)
   - 고객 타입은 위에서 입력한 고객명/전화번호로 자동 매칭 시도

#### 슬랙 모달 동적 갱신

- `block_actions` 이벤트로 상품 드롭다운 변경 감지 → `views.update`로 모달 동적 갱신
- 기존 SMS 모달의 `contact_select` 패턴과 동일
- **프로필 변경 시 연락처 필드 초기화**: 프로필이 바뀌면 이전 프로필의 필수 연락처 필드는 제거하고 새 프로필의 필수 타입 필드만 표시. 기존 입력값은 초기화됨 (모달 갱신 시 새 블록으로 교체)

#### API 호출 순서

1. 모달 오픈 시: `GET /inventory` (상품 목록) + `GET /profiles` (프로필 목록)
2. 상품 선택 시: 프로필 매칭 → `views.update`
3. 제출 시: `POST /orders` → 응답의 주문 ID로 → 연락처별 `POST /orders/{id}/contacts`

### 메시지 템플릿 + SMS 연동

- 주문 상세에서 `currentStageTemplates` 표시
- "📋 복사" 버튼: 템플릿 텍스트를 ephemeral 메시지로 전송
- "📨 보내기" 버튼 흐름:
  1. 템플릿 텍스트가 미리 채워진 SMS 발송 모달 오픈 (수정 가능)
  2. 발송 버튼 클릭 → 컨펌 모달 ("이 내용으로 발송하시겠습니까?")
  3. 컨펌 → SMS Gateway로 발송

---

## 3. 오퍼레이션 시스템

### `/operation` 커맨드 (신규)

| 사용법 | 동작 | API |
|---|---|---|
| `/operation` | 전체 칸반 뷰 | `GET /operations` |
| `/operation [단계명]` | 특정 단계 주문만 | `GET /operations?stageId={id}` |

### 칸반 메시지

전체 단계를 한 메시지에 표시. 각 단계별 주문 수 + 주문 요약 (고객명, 상품, 마감일). 마감 임박(D-1) 표시. 하단에 단계별 "상세" 버튼.

### 단계 상세

단계 상세 버튼 클릭 시 해당 단계의 주문 리스트. 각 주문에:
- 기본 정보
- 마감일 + 임박 경고
- 체크리스트 완료 상태 (n/m 완료)
- 버튼: [주문 상세] [체크리스트] [다음 단계로]

### 체크리스트 모달

"체크리스트" 버튼 클릭 → 현재 단계의 `requiredItems` 기반 모달:
- `checkbox` 타입 → 슬랙 `input` 블록 + `checkboxes` element (각 항목을 option으로)
- `text` 타입 → 슬랙 `input` 블록 + `plain_text_input` element
- 기존 체크 상태/입력값은 모달 오픈 시 `GET /orders/{id}`의 `checklistStatus`에서 복원
- 제출 시 페이로드:
  ```json
  {
    "checklistStatus": [{
      "stageId": "uuid",
      "items": [
        { "id": "item-1", "checked": true },
        { "id": "item-2", "value": "비고 텍스트" }
      ]
    }]
  }
  ```
  → `PATCH /orders/{id}` 호출

### 단계 이동

"다음 단계로" 버튼 클릭:
1. 체크리스트 미완료 시 → "체크리스트를 먼저 완료해주세요" 안내 + `skipChecklist` 우회 옵션
2. 체크리스트 완료 시 → 다음 단계 확인 모달 (마감일 입력 선택)
3. 확인 → `PATCH /operations/{id}/status` 호출

### 마감 알림 크론

- 엔드포인트: `/api/cron/deadline-check`
- 주기: 매일 오전 9시 (KST 기준, vercel.json cron 설정)
- 로직:
  1. `GET /operations` → 전체 주문
  2. 각 주문의 `stageDeadline` 체크 (KST 기준 날짜 비교)
  3. D-1인 주문 필터 (내일 마감)
  4. `SLACK_CHANNEL_OPERATION`에 알림 발송
- 중복 방지: `DeadlineAlertLog` 테이블 사용
  ```prisma
  model DeadlineAlertLog {
    id        String   @id @default(cuid())
    orderId   String
    stageId   String
    alertDate String   // YYYY-MM-DD (KST)
    sentAt    DateTime @default(now())
    @@unique([orderId, stageId, alertDate])
  }
  ```
  동일 주문+단계+날짜 조합이 이미 있으면 스킵 (unique constraint로 보장)
- 알림에 [주문 상세] [다음 단계로] 버튼 포함

---

## 4. 프로필 관리

### `/profile` 커맨드 (신규)

| 사용법 | 동작 | API |
|---|---|---|
| `/profile` | 프로필 목록 | `GET /profiles` |
| `/profile [이름]` | 프로필 상세 | `GET /profiles/{id}` |
| `/profile 수정 [이름]` | 수정 모달 | `PATCH /profiles/{id}` |

### 목록 메시지

프로필별: 이름, 기본 여부, SKU 목록, 필수 연락처 타입. 하단에 프로필별 "수정" 버튼.

### 수정 모달 필드

- 이름 (text input)
- 설명 (text input)
- 기본 프로필 여부 (checkbox — 체크 시 다른 프로필 기본값 해제)
- 필수 연락처 타입 (multi_select — `GET /contact-types`에서 로드)
- variableHints (선택, text input)

---

## 5. CS Tool API 클라이언트 확장

### 새 메서드 (`lib/cs-tool/client.ts`)

```
기존:
  orders.list / get / create / update
  inventory.list / get / inbound / outbound
  operations.list / updateStatus

추가:
  contacts.list / get / create / update / delete
  contactTypes.list / create / delete
  orders.getContacts / assignContact / removeContact
  profiles.list / get / update
  stages.list
```

### 새 타입 (`lib/cs-tool/types.ts`)

```
추가:
  Contact { id, typeId, typeName, typeSlug, name, phone, memo, address, createdAt, updatedAt }
  ContactType { id, name, slug, isDefault }
  OrderContact { type, typeName, name, phone }
  Profile { id, name, description, isDefault, contactTypeIds, skus, variableHints, createdAt, updatedAt }
  Stage { id, name, position, color, defaultDays, requiredItems }
  ChecklistItem { id, type, label, checked?, value? }
  ChecklistStatus { stageId, stageName, complete, items: ChecklistItem[] }
  StageTemplate { contactType, contactTypeName, label, text }

확장:
  Order += contacts, requiredContactTypes, currentStageTemplates, checklistStatus,
           profileId, profileName, templateVariables, stageEnteredAt, stageDeadline
```

---

## 6. 파일 변경 목록

### 삭제

| 파일 | 사유 |
|---|---|
| `lib/slack/options/contacts.ts` | 내부 DB 검색 → `cs-contacts.ts`로 대체 |
| `lib/slack/actions/register-contact.ts` | 내부 DB 저장 → CS Tool API로 대체 |

### 수정

| 파일 | 변경 내용 |
|---|---|
| `prisma/schema.prisma` | Contact 모델 삭제, MessageLog에서 contactId 제거, DeadlineAlertLog 모델 추가 |
| `lib/cs-tool/client.ts` | contacts, contactTypes, profiles, stages, orderContacts 메서드 추가 |
| `lib/cs-tool/types.ts` | 새 타입 추가 + Order 타입 확장 |
| `lib/slack/commands/contact.ts` | 내부 DB → CS Tool API 전환 + 수정 기능 추가 |
| `lib/slack/commands/order.ts` | 주문 상세 풀 정보 + 버튼 액션 + 모달에 프로필/연락처 배정 추가 |
| `lib/slack/commands/sms.ts` | 연락처 검색을 CS Tool API로 변경 |
| `app/api/slack/command/route.ts` | 새 커맨드 라우팅 추가 (/contact-type, /profile, /operation) |
| `app/api/slack/action/route.ts` | 새 액션 핸들러 추가 (체크리스트, 단계 이동, 템플릿 발송, 연락처 배정) |
| `app/api/webhook/sms/route.ts` | Contact 조회를 CS Tool API로 변경 |

### 신규

| 파일 | 역할 |
|---|---|
| `lib/slack/commands/contact-type.ts` | `/contact-type` 커맨드 핸들러 |
| `lib/slack/commands/profile.ts` | `/profile` 커맨드 핸들러 |
| `lib/slack/commands/operation.ts` | `/operation` 커맨드 핸들러 |
| `lib/slack/actions/checklist.ts` | 체크리스트 모달 처리 |
| `lib/slack/actions/stage-move.ts` | 단계 이동 처리 |
| `lib/slack/actions/template-send.ts` | 템플릿 SMS 발송 (컨펌 포함) |
| `lib/slack/actions/order-contact.ts` | 주문-연락처 배정/해제 |
| `lib/slack/options/cs-contacts.ts` | CS Tool API 기반 연락처 검색 (드롭다운용) |
| `lib/slack/messages/operation.ts` | 칸반/단계 상세 메시지 빌더 |
| `lib/slack/messages/order-detail.ts` | 주문 상세 풀 메시지 빌더 |
| `app/api/cron/deadline-check/route.ts` | 마감 D-1 알림 크론 |

---

## 7. 웹훅 / 크론

### 기존 웹훅 (변경 없음)

- SMS Gateway 웹훅 (`/api/webhook/sms`)
- CS Tool 웹훅 (`/api/webhook/cs-tool`) — `order.created`, `order.status_changed`, `inventory.updated`, `inventory.low_stock`

### 신규 크론

- `/api/cron/deadline-check` — 매일 오전 9시, D-1 마감 임박 주문 알림 → `SLACK_CHANNEL_OPERATION`
