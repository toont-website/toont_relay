# Slack ↔ CS Tool 전면 연동 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CS Tool의 연락처/프로필/오퍼레이션/체크리스트/메시지 템플릿을 슬랙에서 풀 관리할 수 있도록 toont_relay를 확장한다.

**Architecture:** Thin Relay — relay는 CS Tool API 호출 + 슬랙 UI 렌더링만 담당. 내부 Contact 테이블을 폐기하고 CS Tool API를 유일한 데이터 소스로 사용. 기존 deferred response + validate/execute 분리 패턴 유지.

**Tech Stack:** Next.js 16, Slack Web API (@slack/web-api), Prisma (MySQL), Zod, Pino, CS Tool REST API

**Spec:** `docs/superpowers/specs/2026-03-24-slack-cs-integration-design.md`

---

## 파일 구조

### 신규 파일

| 파일 | 역할 |
|---|---|
| `src/lib/cs-tool/types.ts` | 타입 확장 (기존 파일 수정) |
| `src/lib/cs-tool/client.ts` | API 클라이언트 확장 (기존 파일 수정) |
| `src/lib/slack/commands/contact-type.ts` | `/contact-type` 커맨드 핸들러 |
| `src/lib/slack/commands/profile.ts` | `/profile` 커맨드 핸들러 |
| `src/lib/slack/commands/operation.ts` | `/operation` 커맨드 핸들러 |
| `src/lib/slack/actions/checklist.ts` | 체크리스트 모달 열기 + 제출 처리 |
| `src/lib/slack/actions/stage-move.ts` | 단계 이동 처리 (컨펌 모달 포함) |
| `src/lib/slack/actions/template-send.ts` | 템플릿 SMS 발송 (컨펌 포함) |
| `src/lib/slack/actions/order-contact.ts` | 주문-연락처 배정/해제 모달 |
| `src/lib/slack/options/cs-contacts.ts` | CS Tool API 기반 연락처 검색 |
| `src/lib/slack/messages/operation.ts` | 칸반/단계 상세 메시지 빌더 |
| `src/lib/slack/messages/order-detail.ts` | 주문 상세 풀 메시지 빌더 |
| `app/api/cron/deadline-check/route.ts` | 마감 D-1 알림 크론 |

### 수정 파일

| 파일 | 변경 |
|---|---|
| `prisma/schema.prisma` | Contact 삭제, MessageLog contactId 제거, DeadlineAlertLog 추가 |
| `src/lib/slack/commands/contact.ts` | 내부 DB → CS Tool API 전환 + 수정 기능 |
| `src/lib/slack/commands/order.ts` | 풀 상세 + 프로필/연락처 모달 확장 |
| `src/lib/slack/commands/sms.ts` | 연락처 검색을 CS Tool API로 변경 |
| `src/app/api/slack/command/route.ts` | 새 커맨드 라우팅 |
| `src/app/api/slack/action/route.ts` | 새 액션 핸들러 |
| `src/app/api/slack/options/route.ts` | CS Tool 연락처 옵션 로드 |
| `src/app/api/webhook/sms/route.ts` | Contact 조회를 API로 변경 |

### 삭제 파일

| 파일 | 사유 |
|---|---|
| `src/lib/slack/options/contacts.ts` | `cs-contacts.ts`로 대체 |
| `src/lib/slack/actions/register-contact.ts` | CS Tool API 호출로 대체 (contact.ts에 통합) |

---

## Phase 1: Foundation (타입 + API 클라이언트 + DB)

### Task 1: CS Tool 타입 확장

**Files:**
- Modify: `src/lib/cs-tool/types.ts`

- [ ] **Step 1: Contact 관련 타입 추가**

```typescript
// src/lib/cs-tool/types.ts — 기존 타입 아래에 추가

// === 연락처 ===

export interface CsContact {
  id: string
  typeId: string
  typeName: string
  typeSlug: string
  name: string
  phone: string
  memo: string | null
  address: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateContactParams {
  name: string
  typeId?: string
  phone?: string
  memo?: string
  address?: string
}

export interface UpdateContactParams {
  name?: string
  typeId?: string
  phone?: string
  memo?: string
  address?: string
}

// === 연락처 타입 ===

export interface ContactType {
  id: string
  name: string
  slug: string
  isDefault: boolean
}

export interface CreateContactTypeParams {
  name: string
  slug: string
}
```

- [ ] **Step 2: Profile, Stage, Checklist 타입 추가**

```typescript
// === 프로필 ===

export interface Profile {
  id: string
  name: string
  description: string | null
  isDefault: boolean
  contactTypeIds: string[]
  skus: string[]
  variableHints: Record<string, string>
  createdAt: string
  updatedAt: string
}

export interface UpdateProfileParams {
  name?: string
  description?: string
  isDefault?: boolean
  contactTypeIds?: string[]
  variableHints?: Record<string, string>
}

// === 파이프라인 단계 ===

export interface Stage {
  id: string
  name: string
  position: number
  color: string
  defaultDays: number
  requiredItems: StageRequiredItem[]
}

export interface StageRequiredItem {
  id: string
  type: "checkbox" | "text"
  label: string
}

// === 체크리스트 ===

export interface ChecklistItem {
  id: string
  type: "checkbox" | "text"
  label: string
  checked?: boolean
  value?: string
}

export interface ChecklistStatus {
  stageId: string
  stageName: string
  complete: boolean
  items: ChecklistItem[]
}

// === 메시지 템플릿 ===

export interface StageTemplate {
  contactType: string
  contactTypeName: string
  label: string
  text: string
}
```

- [ ] **Step 3: Order 타입 확장 + OrderContact + Operation**

```typescript
// === 주문-연락처 ===

export interface OrderContact {
  type: string
  typeName: string
  name: string
  phone: string
}

export interface RequiredContactType {
  id: string
  slug: string
  name: string
}

// === 오퍼레이션 ===

export interface OperationStage {
  id: string
  name: string
  position: number
  color: string
  orders: Order[]
}

export interface OperationBoard {
  stages: OperationStage[]
}

export interface UpdateStageParams {
  stageId: string
  stageDeadline?: string
  skipChecklist?: boolean
}
```

그리고 기존 `Order` 인터페이스에 새 필드 추가:

```typescript
// 기존 Order 인터페이스에 추가
export interface Order {
  // ... 기존 필드 유지
  profileId: string | null
  profileName: string | null
  stageEnteredAt: string | null
  stageDeadline: string | null
  templateVariables: Record<string, string>
  contacts: OrderContact[]
  requiredContactTypes: RequiredContactType[]
  currentStageTemplates: StageTemplate[]
  checklistStatus: ChecklistStatus[]
}
```

- [ ] **Step 4: 커밋**

```bash
git add src/lib/cs-tool/types.ts
git commit -m "feat: CS Tool 연락처/프로필/오퍼레이션/체크리스트 타입 추가"
```

---

### Task 2: CS Tool API 클라이언트 확장

**Files:**
- Modify: `src/lib/cs-tool/client.ts`

- [ ] **Step 1: 연락처 API 메서드 추가**

기존 `CsToolClient` 클래스에 메서드 추가. 기존 `request<T>()` 제네릭 메서드 패턴 그대로 사용:

```typescript
// === 연락처 ===

async getContacts(filters?: {
  type?: string
  search?: string
  page?: number
  limit?: number
}): Promise<CsToolResponse<CsContact[]>> {
  const params: Record<string, string> = {}
  if (filters?.type) params.type = filters.type
  if (filters?.search) params.search = filters.search
  if (filters?.page) params.page = String(filters.page)
  if (filters?.limit) params.limit = String(filters.limit)
  return this.request<CsContact[]>("GET", "/contacts", undefined, params)
}

async getContact(id: string): Promise<CsToolResponse<CsContact>> {
  return this.request<CsContact>("GET", `/contacts/${id}`)
}

async createContact(params: CreateContactParams): Promise<CsToolResponse<CsContact>> {
  return this.request<CsContact>("POST", "/contacts", params)
}

async updateContact(id: string, params: UpdateContactParams): Promise<CsToolResponse<CsContact>> {
  return this.request<CsContact>("PATCH", `/contacts/${id}`, params)
}

async deleteContact(id: string): Promise<CsToolResponse<void>> {
  return this.request<void>("DELETE", `/contacts/${id}`)
}
```

- [ ] **Step 2: 연락처 타입 API 메서드 추가**

```typescript
// === 연락처 타입 ===

async getContactTypes(): Promise<CsToolResponse<ContactType[]>> {
  return this.request<ContactType[]>("GET", "/contact-types")
}

async createContactType(params: CreateContactTypeParams): Promise<CsToolResponse<ContactType>> {
  return this.request<ContactType>("POST", "/contact-types", params)
}

async deleteContactType(id: string): Promise<CsToolResponse<void>> {
  return this.request<void>("DELETE", `/contact-types/${id}`)
}
```

- [ ] **Step 3: 주문-연락처, 프로필, 단계 API 메서드 추가**

```typescript
// === 주문-연락처 ===

async getOrderContacts(orderId: string): Promise<CsToolResponse<OrderContact[]>> {
  return this.request<OrderContact[]>("GET", `/orders/${orderId}/contacts`)
}

async assignOrderContact(orderId: string, contactId: string): Promise<CsToolResponse<void>> {
  return this.request<void>("POST", `/orders/${orderId}/contacts`, { contactId })
}

async removeOrderContact(orderId: string, contactTypeId: string): Promise<CsToolResponse<void>> {
  return this.request<void>("DELETE", `/orders/${orderId}/contacts/${contactTypeId}`)
}

// === 프로필 ===

async getProfiles(): Promise<CsToolResponse<Profile[]>> {
  return this.request<Profile[]>("GET", "/profiles")
}

async getProfile(id: string): Promise<CsToolResponse<Profile>> {
  return this.request<Profile>("GET", `/profiles/${id}`)
}

async updateProfile(id: string, params: UpdateProfileParams): Promise<CsToolResponse<Profile>> {
  return this.request<Profile>("PATCH", `/profiles/${id}`, params)
}

// === 단계 ===

async getStages(): Promise<CsToolResponse<Stage[]>> {
  return this.request<Stage[]>("GET", "/stages")
}

// === 오퍼레이션 (기존 updateStatus 시그니처 확장) ===
// 기존 updateOperationStatus를 수정하여 skipChecklist 지원

async updateOperationStatus(
  orderId: string,
  params: UpdateStageParams
): Promise<CsToolResponse<void>> {
  return this.request<void>("PATCH", `/operations/${orderId}/status`, params)
}
```

- [ ] **Step 4: 빌드 확인**

```bash
npx tsc --noEmit
```

Expected: 컴파일 성공 (기존 코드에서 Order 타입이 확장되므로 기존 사용처에서 에러 없는지 확인)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/cs-tool/client.ts
git commit -m "feat: CS Tool API 클라이언트 — 연락처/프로필/단계/주문연락처 메서드 추가"
```

---

### Task 3: DB 마이그레이션

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Prisma 스키마 수정**

`prisma/schema.prisma`에서:

1. `Contact` 모델 전체 삭제
2. `MessageLog`에서 `contact` relation + `contactId` 필드 제거
3. `DeadlineAlertLog` 모델 추가

```prisma
// Contact 모델 삭제 (전체 제거)

// MessageLog에서 다음 2줄 제거:
//   contact    Contact? @relation(fields: [contactId], references: [id])
//   contactId  String?

// 새 모델 추가:
model DeadlineAlertLog {
  id        String   @id @default(cuid())
  orderId   String
  stageId   String
  alertDate String   // YYYY-MM-DD (KST)
  sentAt    DateTime @default(now())

  @@unique([orderId, stageId, alertDate])
  @@index([alertDate])
}
```

- [ ] **Step 2: 마이그레이션 생성 + 적용**

```bash
npx prisma migrate dev --name remove-contact-add-deadline-alert
```

Expected: 마이그레이션 파일 생성 + DB 적용 성공

- [ ] **Step 3: Prisma Client 재생성 확인**

```bash
npx prisma generate
npx tsc --noEmit
```

Expected: Contact 참조하던 코드에서 타입 에러 발생 (이후 Task에서 수정)

- [ ] **Step 4: 커밋**

```bash
git add prisma/
git commit -m "chore: DB 마이그레이션 — Contact 테이블 삭제, DeadlineAlertLog 추가"
```

---

## Phase 2: 연락처 이관

### Task 4: CS Tool 연락처 드롭다운 옵션

**Files:**
- Create: `src/lib/slack/options/cs-contacts.ts`
- Modify: `src/app/api/slack/options/route.ts`
- Delete: `src/lib/slack/options/contacts.ts`

- [ ] **Step 1: CS Tool 기반 연락처 검색 옵션 생성**

```typescript
// src/lib/slack/options/cs-contacts.ts
import { getCsToolClient } from "@/lib/cs-tool/client"
import { formatPhoneNumber, normalizePhoneNumber } from "@/lib/utils/phone"

const DIRECT_INPUT_VALUE = "__direct_input__"

export async function searchCsContacts(query: string) {
  if (!query.trim()) return { options: [] }

  const client = getCsToolClient()
  const result = await client.getContacts({ search: query, limit: 10 })

  const options = (result.data ?? []).map((c) => ({
    text: {
      type: "plain_text" as const,
      text: `${c.name} (${c.phone ? formatPhoneNumber(c.phone) : "번호 없음"}) [${c.typeName}]`,
    },
    value: JSON.stringify({ id: c.id, phone: c.phone, name: c.name }),
  }))

  // 직접 입력 옵션
  const normalized = normalizePhoneNumber(query)
  options.push({
    text: {
      type: "plain_text" as const,
      text: normalized
        ? `직접 입력: ${formatPhoneNumber(normalized)}`
        : `직접 입력: ${query}`,
    },
    value: JSON.stringify({
      id: DIRECT_INPUT_VALUE,
      phone: normalized ?? query,
      name: null,
    }),
  })

  return { options }
}

export { DIRECT_INPUT_VALUE }
```

- [ ] **Step 2: 옵션 라우트에서 import 교체**

`src/app/api/slack/options/route.ts`에서:
- `import { searchContacts } from "@/lib/slack/options/contacts"` → `import { searchCsContacts } from "@/lib/slack/options/cs-contacts"`
- `searchContacts(query)` → `searchCsContacts(query)` 호출로 변경

- [ ] **Step 3: 기존 contacts.ts 삭제**

```bash
rm src/lib/slack/options/contacts.ts
```

- [ ] **Step 4: 빌드 확인**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: 커밋**

```bash
git add src/lib/slack/options/ src/app/api/slack/options/
git commit -m "refactor: 연락처 드롭다운 — 내부 DB → CS Tool API 전환"
```

---

### Task 5: `/contact` 커맨드 재작성

**Files:**
- Modify: `src/lib/slack/commands/contact.ts`

- [ ] **Step 1: import 교체 + 전체 재작성**

기존 Prisma 호출을 전부 CS Tool API 호출로 교체. 수정 기능 추가.

```typescript
// src/lib/slack/commands/contact.ts
import { getCsToolClient } from "@/lib/cs-tool/client"
import type { CsContact } from "@/lib/cs-tool/types"
import { getSlackClient } from "@/lib/slack/client"
import { formatPhoneNumber, normalizePhoneNumber } from "@/lib/utils/phone"
import { logger } from "@/lib/logger"

export async function handleContactCommand(text: string) {
  const trimmed = text.trim()

  // /contact 추가 → 모달은 별도 처리 (trigger_id 필요하므로 command route에서)
  if (trimmed.startsWith("삭제")) {
    return deleteContact(trimmed.replace("삭제", "").trim())
  }

  if (trimmed.startsWith("수정")) {
    // 수정은 모달이 필요하므로 여기서는 검색만
    return searchForEdit(trimmed.replace("수정", "").trim())
  }

  // 검색 or 전체 목록
  return listContacts(trimmed || undefined)
}

async function listContacts(search?: string) {
  const client = getCsToolClient()
  const result = await client.getContacts(search ? { search } : { limit: 50 })
  const contacts = result.data ?? []

  if (contacts.length === 0) {
    return {
      response_type: "ephemeral",
      text: search
        ? `"${search}" 검색 결과가 없어요.`
        : "등록된 연락처가 없어요.",
    }
  }

  // 타입별 그룹핑
  const grouped = new Map<string, CsContact[]>()
  for (const c of contacts) {
    const key = c.typeName ?? "미분류"
    const group = grouped.get(key) ?? []
    group.push(c)
    grouped.set(key, group)
  }

  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `📇 연락처 목록${search ? ` — "${search}"` : ""}` },
    },
  ]

  for (const [typeName, group] of grouped) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${typeName}*` },
    })

    for (const c of group) {
      const phone = c.phone ? formatPhoneNumber(c.phone) : "-"
      const memo = c.memo ? ` · ${c.memo}` : ""
      blocks.push({
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*${c.name}*\n${phone}` },
          { type: "mrkdwn", text: `${c.address ?? "-"}${memo}` },
        ],
      })
    }

    blocks.push({ type: "divider" })
  }

  if (blocks[blocks.length - 1]?.type === "divider") blocks.pop()

  const total = result.meta?.total ?? contacts.length
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `총 ${total}명` }],
  })

  return { response_type: "ephemeral", text: " ", blocks }
}

async function deleteContact(input: string) {
  if (!input) {
    return { response_type: "ephemeral", text: "삭제할 연락처 이름을 입력해주세요.\n사용법: `/contact 삭제 홍길동`" }
  }

  const client = getCsToolClient()
  const result = await client.getContacts({ search: input, limit: 5 })
  const contacts = result.data ?? []

  if (contacts.length === 0) {
    return { response_type: "ephemeral", text: `"${input}" 연락처를 찾을 수 없어요.` }
  }

  if (contacts.length > 1) {
    const names = contacts.map((c) => `• ${c.name} (${c.typeName})`).join("\n")
    return {
      response_type: "ephemeral",
      text: `여러 연락처가 검색됐어요. 정확한 이름을 입력해주세요:\n${names}`,
    }
  }

  const target = contacts[0]
  await client.deleteContact(target.id)
  logger.info({ contactId: target.id, name: target.name }, "연락처 삭제 완료")

  return {
    response_type: "ephemeral",
    text: `✅ ${target.name} (${target.typeName}) 연락처를 삭제했어요.`,
  }
}

async function searchForEdit(input: string) {
  if (!input) {
    return { response_type: "ephemeral", text: "수정할 연락처 이름을 입력해주세요.\n사용법: `/contact 수정 홍길동`" }
  }

  // 검색 후 결과를 ephemeral로 보여주고, "수정" 버튼 포함
  const client = getCsToolClient()
  const result = await client.getContacts({ search: input, limit: 5 })
  const contacts = result.data ?? []

  if (contacts.length === 0) {
    return { response_type: "ephemeral", text: `"${input}" 연락처를 찾을 수 없어요.` }
  }

  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: "✏️ 수정할 연락처 선택" } },
  ]

  for (const c of contacts) {
    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${c.name}* (${c.typeName})\n${c.phone ? formatPhoneNumber(c.phone) : "-"}`,
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "수정" },
          action_id: "edit_contact",
          value: c.id,
        },
      },
    )
  }

  return { response_type: "ephemeral", text: " ", blocks }
}

// 연락처 등록 모달 오픈
export async function openContactAddModal(triggerId: string) {
  const client = getCsToolClient()
  const slackClient = getSlackClient()
  const typesResult = await client.getContactTypes()
  const types = typesResult.data ?? []

  const typeOptions = types.map((t) => ({
    text: { type: "plain_text" as const, text: t.name },
    value: t.id,
  }))

  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "contact_add_modal",
      title: { type: "plain_text", text: "연락처 등록" },
      submit: { type: "plain_text", text: "등록" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "input",
          block_id: "name_block",
          label: { type: "plain_text", text: "이름" },
          element: {
            type: "plain_text_input",
            action_id: "name_input",
            placeholder: { type: "plain_text", text: "홍길동" },
          },
        },
        {
          type: "input",
          block_id: "type_block",
          label: { type: "plain_text", text: "연락처 타입" },
          optional: true,
          element: {
            type: "static_select",
            action_id: "type_select",
            placeholder: { type: "plain_text", text: "타입 선택" },
            options: typeOptions,
          },
        },
        {
          type: "input",
          block_id: "phone_block",
          label: { type: "plain_text", text: "전화번호" },
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: "phone_input",
            placeholder: { type: "plain_text", text: "010-1234-5678" },
          },
        },
        {
          type: "input",
          block_id: "address_block",
          label: { type: "plain_text", text: "주소" },
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: "address_input",
            placeholder: { type: "plain_text", text: "서울시 강남구" },
          },
        },
        {
          type: "input",
          block_id: "memo_block",
          label: { type: "plain_text", text: "메모" },
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: "memo_input",
            placeholder: { type: "plain_text", text: "VIP 고객" },
          },
        },
      ],
    },
  })
}

// 연락처 등록 모달 제출 처리
export async function handleContactAddSubmit(payload: any) {
  const values = payload.view.state.values
  const name = values.name_block.name_input.value
  const typeId = values.type_block?.type_select?.selected_option?.value
  const phone = values.phone_block?.phone_input?.value
  const address = values.address_block?.address_input?.value
  const memo = values.memo_block?.memo_input?.value

  if (!name) {
    return { response_action: "errors", errors: { name_block: "이름을 입력해주세요." } }
  }

  const normalizedPhone = phone ? normalizePhoneNumber(phone) : undefined

  const client = getCsToolClient()
  await client.createContact({
    name,
    typeId,
    phone: normalizedPhone ?? phone,
    address,
    memo,
  })

  logger.info({ name, phone }, "연락처 등록 완료")
  return null // 성공 시 모달 닫힘
}

// 연락처 수정 모달 오픈
export async function openContactEditModal(triggerId: string, contactId: string) {
  const client = getCsToolClient()
  const slackClient = getSlackClient()

  const [contactResult, typesResult] = await Promise.all([
    client.getContact(contactId),
    client.getContactTypes(),
  ])

  const contact = contactResult.data
  const types = typesResult.data ?? []

  if (!contact) return

  const typeOptions = types.map((t) => ({
    text: { type: "plain_text" as const, text: t.name },
    value: t.id,
  }))

  const initialType = typeOptions.find((o) => o.value === contact.typeId)

  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "contact_edit_modal",
      private_metadata: JSON.stringify({ contactId }),
      title: { type: "plain_text", text: "연락처 수정" },
      submit: { type: "plain_text", text: "저장" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "input",
          block_id: "name_block",
          label: { type: "plain_text", text: "이름" },
          element: {
            type: "plain_text_input",
            action_id: "name_input",
            initial_value: contact.name,
          },
        },
        {
          type: "input",
          block_id: "type_block",
          label: { type: "plain_text", text: "연락처 타입" },
          optional: true,
          element: {
            type: "static_select",
            action_id: "type_select",
            ...(initialType ? { initial_option: initialType } : {}),
            options: typeOptions,
          },
        },
        {
          type: "input",
          block_id: "phone_block",
          label: { type: "plain_text", text: "전화번호" },
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: "phone_input",
            ...(contact.phone ? { initial_value: contact.phone } : {}),
          },
        },
        {
          type: "input",
          block_id: "address_block",
          label: { type: "plain_text", text: "주소" },
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: "address_input",
            ...(contact.address ? { initial_value: contact.address } : {}),
          },
        },
        {
          type: "input",
          block_id: "memo_block",
          label: { type: "plain_text", text: "메모" },
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: "memo_input",
            ...(contact.memo ? { initial_value: contact.memo } : {}),
          },
        },
      ],
    },
  })
}

// 연락처 수정 모달 제출
export async function handleContactEditSubmit(payload: any) {
  const { contactId } = JSON.parse(payload.view.private_metadata)
  const values = payload.view.state.values

  const name = values.name_block.name_input.value
  const typeId = values.type_block?.type_select?.selected_option?.value
  const phone = values.phone_block?.phone_input?.value
  const address = values.address_block?.address_input?.value
  const memo = values.memo_block?.memo_input?.value

  const normalizedPhone = phone ? normalizePhoneNumber(phone) : undefined

  const client = getCsToolClient()
  await client.updateContact(contactId, {
    name,
    typeId,
    phone: normalizedPhone ?? phone,
    address,
    memo,
  })

  logger.info({ contactId, name }, "연락처 수정 완료")
  return null
}
```

- [ ] **Step 2: 빌드 확인**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add src/lib/slack/commands/contact.ts
git commit -m "refactor: /contact 커맨드 — 내부 DB → CS Tool API 전환 + 수정 기능 추가"
```

---

### Task 6: `/contact-type` 커맨드

**Files:**
- Create: `src/lib/slack/commands/contact-type.ts`

- [ ] **Step 1: 연락처 타입 커맨드 구현**

```typescript
// src/lib/slack/commands/contact-type.ts
import { getCsToolClient } from "@/lib/cs-tool/client"
import { logger } from "@/lib/logger"

export async function handleContactTypeCommand(text: string) {
  const trimmed = text.trim()

  if (trimmed.startsWith("추가")) {
    return addContactType(trimmed.replace("추가", "").trim())
  }

  if (trimmed.startsWith("삭제")) {
    return deleteContactType(trimmed.replace("삭제", "").trim())
  }

  return listContactTypes()
}

async function listContactTypes() {
  const client = getCsToolClient()
  const result = await client.getContactTypes()
  const types = result.data ?? []

  if (types.length === 0) {
    return { response_type: "ephemeral", text: "등록된 연락처 타입이 없어요." }
  }

  const lines = types.map((t) => {
    const badge = t.isDefault ? " — 기본" : ""
    return `• ${t.name} (\`${t.slug}\`)${badge}`
  })

  return {
    response_type: "ephemeral",
    text: " ",
    blocks: [
      { type: "header", text: { type: "plain_text", text: "📋 연락처 타입 목록" } },
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "추가: `/contact-type 추가 택배사 courier`\n삭제: `/contact-type 삭제 택배사`",
          },
        ],
      },
    ],
  }
}

async function addContactType(input: string) {
  const parts = input.split(/\s+/)
  if (parts.length < 2) {
    return {
      response_type: "ephemeral",
      text: "사용법: `/contact-type 추가 [이름] [slug]`\n예: `/contact-type 추가 택배사 courier`\nslug는 영소문자, 숫자, -, _ 만 가능",
    }
  }

  const [name, slug] = parts
  const client = getCsToolClient()

  try {
    await client.createContactType({ name, slug })
    logger.info({ name, slug }, "연락처 타입 추가")
    return { response_type: "ephemeral", text: `✅ 연락처 타입 "${name}" (\`${slug}\`)을 추가했어요.` }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러"
    if (msg.includes("CONFLICT") || msg.includes("409")) {
      return { response_type: "ephemeral", text: `이미 존재하는 slug입니다: \`${slug}\`` }
    }
    return { response_type: "ephemeral", text: `타입 추가 실패: ${msg}` }
  }
}

async function deleteContactType(input: string) {
  if (!input) {
    return { response_type: "ephemeral", text: "삭제할 타입 이름을 입력해주세요.\n사용법: `/contact-type 삭제 택배사`" }
  }

  const client = getCsToolClient()
  const result = await client.getContactTypes()
  const types = result.data ?? []
  const target = types.find((t) => t.name === input || t.slug === input)

  if (!target) {
    return { response_type: "ephemeral", text: `"${input}" 타입을 찾을 수 없어요.` }
  }

  try {
    await client.deleteContactType(target.id)
    logger.info({ name: target.name, slug: target.slug }, "연락처 타입 삭제")
    return { response_type: "ephemeral", text: `✅ 연락처 타입 "${target.name}"을 삭제했어요.` }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러"
    if (msg.includes("FORBIDDEN") || msg.includes("403")) {
      return { response_type: "ephemeral", text: `기본 타입은 삭제할 수 없어요: "${target.name}"` }
    }
    return { response_type: "ephemeral", text: `타입 삭제 실패: ${msg}` }
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/slack/commands/contact-type.ts
git commit -m "feat: /contact-type 커맨드 — 연락처 타입 목록/추가/삭제"
```

---

### Task 7: SMS 웹훅 Contact 조회 변경

**Files:**
- Modify: `src/app/api/webhook/sms/route.ts`
- Delete: `src/lib/slack/actions/register-contact.ts`

- [ ] **Step 1: SMS 웹훅에서 Contact 조회를 CS Tool API로 변경**

`src/app/api/webhook/sms/route.ts`에서:

1. `prisma.contact.findUnique({ where: { phoneNumber } })` → `getCsToolClient().getContacts({ search: phoneNumber, limit: 1 })`
2. `contact?.name` → `csContacts[0]?.name`
3. `contact?.id` → 제거 (MessageLog에서 contactId 삭제됨)
4. MessageLog 생성 시 `contactId` 필드 제거

```typescript
// 변경 전:
// const contact = await prisma.contact.findUnique({ where: { phoneNumber } })

// 변경 후:
const csClient = getCsToolClient()
const contactResult = await csClient.getContacts({ search: phoneNumber, limit: 1 })
const csContact = (contactResult.data ?? []).find(
  (c) => c.phone && normalizePhoneNumber(c.phone) === phoneNumber
)

// contact?.name → csContact?.name
// contact?.id 사용처 → 제거

// MessageLog 생성에서 contactId 제거:
const log = await prisma.messageLog.create({
  data: {
    direction: "inbound",
    phoneNumber,
    message,
    status: "received",
    // contactId 필드 제거
  },
})
```

- [ ] **Step 2: "연락처 등록" 버튼 액션 변경**

기존 `register-contact.ts`를 삭제하고, action route에서 등록 액션을 contact.ts의 `openContactAddModal`로 연결:

```bash
rm src/lib/slack/actions/register-contact.ts
```

`src/app/api/slack/action/route.ts`에서 `register_contact` 액션 핸들러를:
- 기존: Prisma로 직접 저장
- 변경: `openContactAddModal(triggerId)` 호출 (모달로 등록). private_metadata에 phoneNumber 전달

- [ ] **Step 3: 빌드 확인**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/webhook/sms/route.ts src/app/api/slack/action/route.ts
git rm src/lib/slack/actions/register-contact.ts
git commit -m "refactor: SMS 웹훅 + 연락처 등록 — 내부 DB → CS Tool API 전환"
```

---

### Task 8: SMS 커맨드 연락처 검색 변경

**Files:**
- Modify: `src/lib/slack/commands/sms.ts`

- [ ] **Step 1: SMS 모달의 연락처 관련 코드 변경**

`sms.ts`에서 Prisma Contact 참조를 CS Tool API로 변경:
- 연락처 조회: `prisma.contact.findFirst/findMany` → `getCsToolClient().getContacts({ search })`
- `contact.phoneNumber` → `csContact.phone`
- `contact.name` → `csContact.name`

실제로 sms.ts에서 Contact DB를 직접 조회하는 부분만 교체. 드롭다운 검색은 이미 Task 4에서 `cs-contacts.ts`로 교체됨.

- [ ] **Step 2: 빌드 확인**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add src/lib/slack/commands/sms.ts
git commit -m "refactor: /sms 커맨드 — 연락처 검색을 CS Tool API로 전환"
```

---

## Phase 3: 주문 시스템 확장

### Task 9: 주문 상세 메시지 빌더

**Files:**
- Create: `src/lib/slack/messages/order-detail.ts`

- [ ] **Step 1: 풀 주문 상세 메시지 빌더 구현**

```typescript
// src/lib/slack/messages/order-detail.ts
import type { Order } from "@/lib/cs-tool/types"
import { formatPhoneNumber } from "@/lib/utils/phone"

const STATUS_MAP: Record<string, string> = {
  pending: "대기",
  in_progress: "진행중",
  completed: "완료",
  cancelled: "취소",
}

export function buildOrderDetailMessage(order: Order) {
  const phone = order.phone ? formatPhoneNumber(order.phone) : "-"
  const status = STATUS_MAP[order.status] ?? order.status
  const dueDate = order.dueDate ?? "-"

  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `📦 주문 상세 — ${order.orderId ?? order.id.slice(0, 8)}` },
    },
    { type: "divider" },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*👤 고객:* ${order.customerName} (${phone})` },
        { type: "mrkdwn", text: `*📦 상품:* ${order.itemDescription} x${order.quantity}` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*📍 배송지:* ${order.address ?? "-"}` },
        { type: "mrkdwn", text: `*📅 납기일:* ${dueDate}` },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*🔄 상태:* ${status}` },
        { type: "mrkdwn", text: `*📋 프로필:* ${order.profileName ?? "-"}` },
      ],
    },
  ]

  // 현재 단계 + 진행률
  if (order.currentStageName) {
    const deadline = order.stageDeadline
      ? new Date(order.stageDeadline).toLocaleDateString("ko-KR")
      : "-"
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `▸ *현재 단계:* ${order.currentStageName} (${deadline}까지)\n▸ *진행률:* ${order.progress ?? "-"}%`,
      },
    })
  }

  // 배정 연락처
  if (order.requiredContactTypes.length > 0) {
    blocks.push({ type: "divider" })
    const contactLines = order.requiredContactTypes.map((rt) => {
      const assigned = order.contacts.find((c) => c.type === rt.slug)
      return assigned
        ? `✅ ${rt.name}: ${assigned.name} (${assigned.phone ? formatPhoneNumber(assigned.phone) : "-"})`
        : `⚠️ ${rt.name}: 미배정`
    })
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*━━ 배정 연락처 ━━*\n${contactLines.join("\n")}` },
    })
  }

  // 체크리스트
  if (order.checklistStatus.length > 0) {
    blocks.push({ type: "divider" })
    const checklistLines = order.checklistStatus.flatMap((cs) => {
      const header = `*━━ 체크리스트 (${cs.stageName}) ━━*`
      const items = cs.items.map((item) => {
        if (item.type === "checkbox") {
          return item.checked ? `☑️ ${item.label}` : `☐ ${item.label}`
        }
        return `📝 ${item.label}: "${item.value ?? "-"}"`
      })
      return [header, ...items]
    })
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: checklistLines.join("\n") },
    })
  }

  // 메시지 템플릿
  if (order.currentStageTemplates.length > 0) {
    blocks.push({ type: "divider" })
    const templateLines = order.currentStageTemplates.map(
      (t) => `📨 ${t.contactTypeName} → ${t.label}\n> ${t.text}`
    )
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*━━ 메시지 템플릿 ━━*\n${templateLines.join("\n\n")}` },
    })
  }

  // 액션 버튼
  const actions: any[] = []

  const hasUnassigned = order.requiredContactTypes.some(
    (rt) => !order.contacts.find((c) => c.type === rt.slug)
  )
  if (hasUnassigned) {
    actions.push({
      type: "button",
      text: { type: "plain_text", text: "연락처 배정" },
      action_id: "assign_order_contact",
      value: order.id,
    })
  }

  if (order.checklistStatus.some((cs) => !cs.complete)) {
    actions.push({
      type: "button",
      text: { type: "plain_text", text: "체크리스트 작성" },
      action_id: "open_checklist",
      value: order.id,
    })
  }

  if (order.currentStageTemplates.length > 0) {
    actions.push(
      {
        type: "button",
        text: { type: "plain_text", text: "📋 복사" },
        action_id: "copy_template",
        value: order.id,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "📨 보내기" },
        action_id: "send_template_sms",
        value: order.id,
        style: "primary",
      },
    )
  }

  if (actions.length > 0) {
    blocks.push({ type: "actions", elements: actions })
  }

  // 메모
  if (order.notes) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `📝 메모: ${order.notes}` }],
    })
  }

  return { response_type: "ephemeral" as const, text: " ", blocks }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/slack/messages/order-detail.ts
git commit -m "feat: 주문 상세 풀 메시지 빌더 — 연락처+체크리스트+템플릿+버튼"
```

---

### Task 10: `/order` 커맨드 상세 조회 업데이트

**Files:**
- Modify: `src/lib/slack/commands/order.ts`

- [ ] **Step 1: 주문 상세 조회에 풀 메시지 적용**

`order.ts`의 `handleOrderCommand`에서:
- 주문 ID로 직접 조회 시 (`GET /orders/{id}`) → `buildOrderDetailMessage(order)` 반환
- 기존 목록 조회는 유지하되, 각 주문에 "상세" 버튼 추가

```typescript
import { buildOrderDetailMessage } from "@/lib/slack/messages/order-detail"

// 기존 handleOrderCommand 안에서:
// 주문 ID 매칭 시 상세 조회
// 기존 주문 목록의 각 항목에 버튼 추가:
{
  type: "button",
  text: { type: "plain_text", text: "상세" },
  action_id: "view_order_detail",
  value: order.id,
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/slack/commands/order.ts
git commit -m "feat: /order 상세 조회 — 풀 정보 메시지 + 상세 버튼"
```

---

### Task 11: `/order-add` 모달 확장 (프로필 + 연락처)

**Files:**
- Modify: `src/lib/slack/commands/order.ts`

- [ ] **Step 1: 모달 오픈 시 프로필 데이터 로드**

`handleOrderCreateCommand`에서:
- 기존 `GET /inventory` + 새로 `GET /profiles` 병렬 호출
- 프로필 데이터를 `private_metadata`에 저장 (모달 갱신 시 참조)

- [ ] **Step 2: 상품 선택 시 프로필 매칭 + 모달 갱신 (block_actions)**

`action/route.ts`에서 `product_select` 액션 처리:
1. 선택된 SKU에 매칭되는 프로필 필터
2. 프로필 1개: 자동 선택 (context 블록으로 표시)
3. 프로필 2개+: 드롭다운 추가
4. 프로필의 `requiredContactTypes`에 따라 `external_select` 필드 동적 추가
5. `views.update`로 모달 갱신

- [ ] **Step 3: 주문 제출 시 연락처 배정 로직**

`validateOrderAdd` + `executeOrderAdd` 확장:
- validation에서 프로필 ID + 연락처 선택값 추출
- execution에서:
  1. `POST /orders` (profileId 포함)
  2. 각 연락처별 `POST /orders/{id}/contacts`

- [ ] **Step 4: 빌드 확인**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: 커밋**

```bash
git add src/lib/slack/commands/order.ts src/app/api/slack/action/route.ts
git commit -m "feat: /order-add 모달 — 프로필 선택 + 연락처 동적 배정"
```

---

### Task 12: 주문-연락처 배정 액션

**Files:**
- Create: `src/lib/slack/actions/order-contact.ts`

- [ ] **Step 1: 연락처 배정 모달 구현**

```typescript
// src/lib/slack/actions/order-contact.ts
import { getCsToolClient } from "@/lib/cs-tool/client"
import { getSlackClient } from "@/lib/slack/client"
import { logger } from "@/lib/logger"

export async function openOrderContactModal(triggerId: string, orderId: string) {
  const client = getCsToolClient()
  const slackClient = getSlackClient()

  const order = await client.getOrder(orderId)
  if (!order.data) return

  const unassigned = order.data.requiredContactTypes.filter(
    (rt) => !order.data!.contacts.find((c) => c.type === rt.slug)
  )

  if (unassigned.length === 0) return

  const blocks = unassigned.map((rt) => ({
    type: "input",
    block_id: `contact_${rt.slug}`,
    label: { type: "plain_text", text: `${rt.name} 연락처` },
    element: {
      type: "external_select",
      action_id: `contact_select_${rt.slug}`,
      placeholder: { type: "plain_text", text: `${rt.name} 검색...` },
      min_query_length: 1,
    },
  }))

  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "order_contact_modal",
      private_metadata: JSON.stringify({ orderId }),
      title: { type: "plain_text", text: "연락처 배정" },
      submit: { type: "plain_text", text: "배정" },
      close: { type: "plain_text", text: "취소" },
      blocks,
    },
  })
}

export async function handleOrderContactSubmit(payload: any) {
  const { orderId } = JSON.parse(payload.view.private_metadata)
  const values = payload.view.state.values
  const client = getCsToolClient()

  for (const [blockId, blockValue] of Object.entries(values)) {
    if (!blockId.startsWith("contact_")) continue
    const actionValue = Object.values(blockValue as any)[0] as any
    const selected = actionValue?.selected_option?.value
    if (!selected) continue

    const parsed = JSON.parse(selected)
    if (parsed.id === "__direct_input__") continue

    await client.assignOrderContact(orderId, parsed.id)
  }

  logger.info({ orderId }, "주문 연락처 배정 완료")
  return null
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/slack/actions/order-contact.ts
git commit -m "feat: 주문-연락처 배정 모달 — 미배정 타입별 검색/배정"
```

---

### Task 13: 템플릿 SMS 발송 액션

**Files:**
- Create: `src/lib/slack/actions/template-send.ts`

- [ ] **Step 1: 템플릿 복사 + SMS 발송 구현**

```typescript
// src/lib/slack/actions/template-send.ts
import { getCsToolClient } from "@/lib/cs-tool/client"
import { getSlackClient } from "@/lib/slack/client"
import { getSmsGatewayClient } from "@/lib/sms-gateway/client"
import { getEnv } from "@/lib/config/env"
import { logger } from "@/lib/logger"

// 📋 복사 버튼 → ephemeral 메시지로 텍스트 전달
export async function handleCopyTemplate(orderId: string, userId: string, channelId: string) {
  const client = getCsToolClient()
  const slackClient = getSlackClient()
  const order = await client.getOrder(orderId)
  if (!order.data) return

  const templates = order.data.currentStageTemplates
  if (templates.length === 0) return

  const text = templates
    .map((t) => `*[${t.contactTypeName} — ${t.label}]*\n${t.text}`)
    .join("\n\n")

  await slackClient.chat.postEphemeral({
    channel: channelId,
    user: userId,
    text,
  })
}

// 📨 보내기 버튼 → SMS 발송 모달 (템플릿 미리 채움)
export async function openTemplateSendModal(triggerId: string, orderId: string) {
  const client = getCsToolClient()
  const slackClient = getSlackClient()
  const order = await client.getOrder(orderId)
  if (!order.data) return

  const template = order.data.currentStageTemplates[0]
  if (!template) return

  const contact = order.data.contacts.find((c) => c.type === template.contactType)
  const phone = contact?.phone ?? order.data.phone ?? ""

  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "template_sms_modal",
      private_metadata: JSON.stringify({ orderId, phone, contactName: contact?.name }),
      title: { type: "plain_text", text: "문자 발송" },
      submit: { type: "plain_text", text: "발송" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `📨 *${template.contactTypeName}* → ${template.label}` },
          ],
        },
        {
          type: "input",
          block_id: "phone_block",
          label: { type: "plain_text", text: "수신 번호" },
          element: {
            type: "plain_text_input",
            action_id: "phone_input",
            initial_value: phone,
          },
        },
        {
          type: "input",
          block_id: "message_block",
          label: { type: "plain_text", text: "메시지 (수정 가능)" },
          element: {
            type: "plain_text_input",
            action_id: "message_input",
            multiline: true,
            initial_value: template.text,
          },
        },
      ],
    },
  })
}

// 발송 제출 → 컨펌 모달
export async function validateTemplateSms(payload: any) {
  const values = payload.view.state.values
  const phone = values.phone_block.phone_input.value
  const message = values.message_block.message_input.value
  const metadata = JSON.parse(payload.view.private_metadata)

  if (!phone || !message) {
    return {
      response_action: "errors",
      errors: {
        ...(phone ? {} : { phone_block: "수신 번호를 입력해주세요." }),
        ...(message ? {} : { message_block: "메시지를 입력해주세요." }),
      },
    }
  }

  // 컨펌 모달로 전환 (push)
  return {
    response_action: "push",
    view: {
      type: "modal",
      callback_id: "template_sms_confirm",
      private_metadata: JSON.stringify({ ...metadata, phone, message }),
      title: { type: "plain_text", text: "발송 확인" },
      submit: { type: "plain_text", text: "발송" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*수신:* ${phone}\n*내용:*\n> ${message.replace(/\n/g, "\n> ")}`,
          },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: "⚠️ 이 내용으로 문자를 발송하시겠습니까?" },
        },
      ],
    },
  }
}

// 컨펌 후 실제 발송
export async function executeTemplateSms(payload: any) {
  const { phone, message, orderId, contactName } = JSON.parse(payload.view.private_metadata)
  const userId = payload.user.id

  const smsClient = getSmsGatewayClient()
  const slackClient = getSlackClient()
  const env = getEnv()

  try {
    await smsClient.sendMessage(phone, message)
    logger.info({ phone, orderId, userId }, "템플릿 SMS 발송 완료")
  } catch (error) {
    logger.error({ error, phone, orderId }, "템플릿 SMS 발송 실패")
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/slack/actions/template-send.ts
git commit -m "feat: 템플릿 SMS 발송 — 복사/발송 모달/컨펌 플로우"
```

---

## Phase 4: 오퍼레이션

### Task 14: 칸반 뷰 메시지 빌더 + `/operation` 커맨드

**Files:**
- Create: `src/lib/slack/messages/operation.ts`
- Create: `src/lib/slack/commands/operation.ts`

- [ ] **Step 1: 오퍼레이션 메시지 빌더**

```typescript
// src/lib/slack/messages/operation.ts
import type { OperationBoard, OperationStage, Order } from "@/lib/cs-tool/types"

const STAGE_EMOJI: Record<string, string> = {
  blue: "🔵",
  orange: "🟠",
  green: "🟢",
  red: "🔴",
  purple: "🟣",
  yellow: "🟡",
}

function isDeadlineApproaching(deadline: string | null): boolean {
  if (!deadline) return false
  const d = new Date(deadline)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return d <= tomorrow
}

export function buildKanbanMessage(board: OperationBoard) {
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: "🔄 오퍼레이션 현황" } },
    { type: "divider" },
  ]

  for (const stage of board.stages) {
    const emoji = STAGE_EMOJI[stage.color] ?? "⚪"
    const lines = stage.orders.slice(0, 5).map((o) => {
      const deadline = o.stageDeadline
        ? new Date(o.stageDeadline).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })
        : ""
      const warn = isDeadlineApproaching(o.stageDeadline) ? " ⚠️ D-1" : ""
      return `  • ${o.orderId ?? o.customerName} — ${o.customerName} / ${o.itemDescription} x${o.quantity}${deadline ? ` / ~${deadline}` : ""}${warn}`
    })

    const more = stage.orders.length > 5 ? `\n  _...외 ${stage.orders.length - 5}건_` : ""

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} *${stage.name}* (${stage.orders.length}건)\n${lines.join("\n")}${more}`,
      },
    })
  }

  // 단계별 상세 버튼
  const buttons = board.stages.map((s) => ({
    type: "button",
    text: { type: "plain_text", text: `${s.name} 상세` },
    action_id: `stage_detail_${s.id}`,
    value: s.id,
  }))

  if (buttons.length > 0) {
    blocks.push({ type: "actions", elements: buttons.slice(0, 5) })
  }

  return { response_type: "ephemeral" as const, text: " ", blocks }
}

export function buildStageDetailMessage(stage: OperationStage) {
  const emoji = STAGE_EMOJI[stage.color] ?? "⚪"

  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: `${emoji} ${stage.name} 단계 상세` } },
    { type: "divider" },
  ]

  for (const order of stage.orders) {
    const deadline = order.stageDeadline
      ? new Date(order.stageDeadline).toLocaleDateString("ko-KR")
      : "-"
    const warn = isDeadlineApproaching(order.stageDeadline) ? " ⚠️ D-1" : ""

    const checklistInfo = order.checklistStatus.length > 0
      ? order.checklistStatus.map((cs) => {
          const done = cs.items.filter((i) => i.type === "checkbox" ? i.checked : !!i.value).length
          return cs.complete ? "✅ 완료" : `${done}/${cs.items.length} 완료`
        }).join(", ")
      : ""

    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📦 *${order.orderId ?? order.customerName}* — ${order.customerName} / ${order.itemDescription} x${order.quantity}\n   📅 마감: ${deadline}${warn}${checklistInfo ? `\n   체크리스트: ${checklistInfo}` : ""}`,
        },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "주문 상세" },
            action_id: "view_order_detail",
            value: order.id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "체크리스트" },
            action_id: "open_checklist",
            value: order.id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "다음 단계로" },
            action_id: "move_next_stage",
            value: order.id,
            style: "primary",
          },
        ],
      },
    )
  }

  if (stage.orders.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_이 단계에 주문이 없어요._" },
    })
  }

  return { response_type: "ephemeral" as const, text: " ", blocks }
}
```

- [ ] **Step 2: /operation 커맨드 핸들러**

```typescript
// src/lib/slack/commands/operation.ts
import { getCsToolClient } from "@/lib/cs-tool/client"
import { buildKanbanMessage, buildStageDetailMessage } from "@/lib/slack/messages/operation"

export async function handleOperationCommand(text: string) {
  const client = getCsToolClient()
  const trimmed = text.trim()

  if (trimmed) {
    // 단계명으로 검색
    const stages = await client.getStages()
    const stage = (stages.data ?? []).find(
      (s) => s.name === trimmed || s.name.includes(trimmed)
    )

    if (stage) {
      const result = await client.getOperations({ stageId: stage.id })
      const board = result.data
      if (!board) return { response_type: "ephemeral", text: "오퍼레이션 조회에 실패했어요." }
      const stageData = board.stages.find((s) => s.id === stage.id)
      if (stageData) return buildStageDetailMessage(stageData)
    }

    return { response_type: "ephemeral", text: `"${trimmed}" 단계를 찾을 수 없어요.` }
  }

  // 전체 칸반 뷰
  const result = await client.getOperations()
  const board = result.data

  if (!board) {
    return { response_type: "ephemeral", text: "오퍼레이션 조회에 실패했어요." }
  }

  return buildKanbanMessage(board)
}
```

- [ ] **Step 3: 커밋**

```bash
git add src/lib/slack/messages/operation.ts src/lib/slack/commands/operation.ts
git commit -m "feat: /operation 커맨드 + 칸반 뷰/단계 상세 메시지 빌더"
```

---

### Task 15: 체크리스트 모달 액션

**Files:**
- Create: `src/lib/slack/actions/checklist.ts`

- [ ] **Step 1: 체크리스트 모달 열기 + 제출 처리**

```typescript
// src/lib/slack/actions/checklist.ts
import { getCsToolClient } from "@/lib/cs-tool/client"
import { getSlackClient } from "@/lib/slack/client"
import { logger } from "@/lib/logger"

export async function openChecklistModal(triggerId: string, orderId: string) {
  const client = getCsToolClient()
  const slackClient = getSlackClient()
  const orderResult = await client.getOrder(orderId)
  const order = orderResult.data
  if (!order) return

  // 현재 단계의 체크리스트 찾기
  const currentChecklist = order.checklistStatus.find(
    (cs) => cs.stageId === order.currentStageId
  )
  if (!currentChecklist || currentChecklist.items.length === 0) return

  const blocks = currentChecklist.items.map((item) => {
    if (item.type === "checkbox") {
      return {
        type: "input",
        block_id: `check_${item.id}`,
        label: { type: "plain_text", text: item.label },
        optional: true,
        element: {
          type: "checkboxes",
          action_id: `checkbox_${item.id}`,
          options: [
            {
              text: { type: "plain_text", text: item.label },
              value: "checked",
            },
          ],
          ...(item.checked
            ? {
                initial_options: [
                  { text: { type: "plain_text", text: item.label }, value: "checked" },
                ],
              }
            : {}),
        },
      }
    }

    // text 타입
    return {
      type: "input",
      block_id: `text_${item.id}`,
      label: { type: "plain_text", text: item.label },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: `textinput_${item.id}`,
        ...(item.value ? { initial_value: item.value } : {}),
        placeholder: { type: "plain_text", text: `${item.label} 입력` },
      },
    }
  })

  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "checklist_modal",
      private_metadata: JSON.stringify({
        orderId,
        stageId: order.currentStageId,
      }),
      title: { type: "plain_text", text: `📋 체크리스트` },
      submit: { type: "plain_text", text: "저장" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `*${order.customerName}* · ${order.currentStageName} 단계` },
          ],
        },
        ...blocks,
      ],
    },
  })
}

export async function handleChecklistSubmit(payload: any) {
  const { orderId, stageId } = JSON.parse(payload.view.private_metadata)
  const values = payload.view.state.values

  const items: Array<{ id: string; checked?: boolean; value?: string }> = []

  for (const [blockId, blockValue] of Object.entries(values)) {
    if (blockId.startsWith("check_")) {
      const itemId = blockId.replace("check_", "")
      const actionValue = Object.values(blockValue as any)[0] as any
      const checked = (actionValue?.selected_options?.length ?? 0) > 0
      items.push({ id: itemId, checked })
    } else if (blockId.startsWith("text_")) {
      const itemId = blockId.replace("text_", "")
      const actionValue = Object.values(blockValue as any)[0] as any
      const value = actionValue?.value ?? ""
      items.push({ id: itemId, value })
    }
  }

  const client = getCsToolClient()
  await client.updateOrder(orderId, {
    checklistStatus: [{ stageId, items }],
  } as any)

  logger.info({ orderId, stageId, itemCount: items.length }, "체크리스트 저장")
  return null
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/slack/actions/checklist.ts
git commit -m "feat: 체크리스트 모달 — 열기/저장 (checkbox + text)"
```

---

### Task 16: 단계 이동 액션

**Files:**
- Create: `src/lib/slack/actions/stage-move.ts`

- [ ] **Step 1: 단계 이동 처리 구현**

```typescript
// src/lib/slack/actions/stage-move.ts
import { getCsToolClient } from "@/lib/cs-tool/client"
import { getSlackClient } from "@/lib/slack/client"
import { logger } from "@/lib/logger"

export async function handleMoveNextStage(triggerId: string, orderId: string) {
  const client = getCsToolClient()
  const slackClient = getSlackClient()

  const [orderResult, stagesResult] = await Promise.all([
    client.getOrder(orderId),
    client.getStages(),
  ])

  const order = orderResult.data
  const stages = stagesResult.data ?? []
  if (!order) return

  // 현재 단계 찾기 → 다음 단계 결정
  const currentIdx = stages.findIndex((s) => s.id === order.currentStageId)
  const nextStage = currentIdx >= 0 && currentIdx < stages.length - 1
    ? stages[currentIdx + 1]
    : null

  if (!nextStage) {
    await slackClient.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        title: { type: "plain_text", text: "단계 이동" },
        close: { type: "plain_text", text: "확인" },
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "이미 마지막 단계에 있어요." },
          },
        ],
      },
    })
    return
  }

  // 체크리스트 미완료 체크
  const currentChecklist = order.checklistStatus.find(
    (cs) => cs.stageId === order.currentStageId
  )
  const hasIncomplete = currentChecklist && !currentChecklist.complete

  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${order.customerName}* · ${order.itemDescription}\n\n${order.currentStageName} → *${nextStage.name}*`,
      },
    },
  ]

  if (hasIncomplete) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "⚠️ 현재 단계의 체크리스트가 완료되지 않았어요.",
      },
    })
    blocks.push({
      type: "input",
      block_id: "skip_block",
      label: { type: "plain_text", text: "체크리스트 건너뛰기" },
      optional: true,
      element: {
        type: "checkboxes",
        action_id: "skip_checkbox",
        options: [
          {
            text: { type: "plain_text", text: "체크리스트 미완료 상태로 이동" },
            value: "skip",
          },
        ],
      },
    })
  }

  // 마감일 입력 (선택)
  blocks.push({
    type: "input",
    block_id: "deadline_block",
    label: { type: "plain_text", text: `${nextStage.name} 마감일 (선택)` },
    optional: true,
    element: {
      type: "datepicker",
      action_id: "deadline_picker",
      placeholder: { type: "plain_text", text: "미입력 시 자동 계산" },
    },
  })

  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "stage_move_modal",
      private_metadata: JSON.stringify({
        orderId,
        nextStageId: nextStage.id,
        nextStageName: nextStage.name,
        hasIncomplete,
      }),
      title: { type: "plain_text", text: "단계 이동" },
      submit: { type: "plain_text", text: "이동" },
      close: { type: "plain_text", text: "취소" },
      blocks,
    },
  })
}

export async function handleStageMoveSubmit(payload: any) {
  const metadata = JSON.parse(payload.view.private_metadata)
  const { orderId, nextStageId, hasIncomplete } = metadata
  const values = payload.view.state.values

  const skipChecklist = hasIncomplete
    ? (values.skip_block?.skip_checkbox?.selected_options?.length ?? 0) > 0
    : false

  if (hasIncomplete && !skipChecklist) {
    return {
      response_action: "errors",
      errors: { skip_block: "체크리스트를 먼저 완료하거나, 건너뛰기를 선택해주세요." },
    }
  }

  const deadline = values.deadline_block?.deadline_picker?.selected_date

  const client = getCsToolClient()

  try {
    await client.updateOperationStatus(orderId, {
      stageId: nextStageId,
      ...(deadline ? { stageDeadline: deadline } : {}),
      ...(skipChecklist ? { skipChecklist: true } : {}),
    })

    logger.info({ orderId, nextStageId, skipChecklist }, "단계 이동 완료")
    return null
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러"
    logger.error({ error: msg, orderId }, "단계 이동 실패")
    return {
      response_action: "errors",
      errors: { deadline_block: `단계 이동 실패: ${msg}` },
    }
  }
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/slack/actions/stage-move.ts
git commit -m "feat: 단계 이동 모달 — 체크리스트 검증 + skipChecklist + 마감일"
```

---

### Task 17: 마감 알림 크론

**Files:**
- Create: `src/app/api/cron/deadline-check/route.ts`
- Modify: `vercel.json` (크론 설정 추가)

- [ ] **Step 1: 크론 핸들러 구현**

```typescript
// src/app/api/cron/deadline-check/route.ts
import { NextRequest, NextResponse } from "next/server"
import { getEnv } from "@/lib/config/env"
import { getCsToolClient } from "@/lib/cs-tool/client"
import { getSlackClient } from "@/lib/slack/client"
import { prisma } from "@/lib/db/prisma"
import { logger } from "@/lib/logger"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const env = getEnv()
  const authHeader = request.headers.get("authorization")
  const token = authHeader?.replace("Bearer ", "")

  if (token !== env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const client = getCsToolClient()
  const slackClient = getSlackClient()

  const result = await client.getOperations()
  const board = result.data
  if (!board) {
    return NextResponse.json({ error: "Failed to fetch operations" }, { status: 500 })
  }

  // KST 기준 날짜 계산 (UTC+9)
  const now = new Date()
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const kstTomorrow = new Date(kstNow.getTime() + 24 * 60 * 60 * 1000)
  const tomorrowStr = kstTomorrow.toISOString().split("T")[0]
  const todayStr = kstNow.toISOString().split("T")[0]

  let alertCount = 0

  for (const stage of board.stages) {
    for (const order of stage.orders) {
      if (!order.stageDeadline) continue

      const deadlineStr = order.stageDeadline.split("T")[0]
      if (deadlineStr !== tomorrowStr) continue

      // 중복 방지
      try {
        await prisma.deadlineAlertLog.create({
          data: {
            orderId: order.id,
            stageId: stage.id,
            alertDate: todayStr,
          },
        })
      } catch (error: any) {
        if (error?.code === "P2002") {
          // 이미 발송됨
          continue
        }
        throw error
      }

      // 알림 발송
      await slackClient.chat.postMessage({
        channel: env.SLACK_CHANNEL_OPERATION,
        text: " ",
        attachments: [
          {
            color: "#FFB800",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `⏰ *마감 임박 알림*\n\n📦 ${order.orderId ?? order.customerName} — ${order.customerName} / ${order.itemDescription} x${order.quantity}\n   현재 단계: ${stage.name}\n   마감일: 내일 (${tomorrowStr})`,
                },
              },
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "주문 상세" },
                    action_id: "view_order_detail",
                    value: order.id,
                  },
                  {
                    type: "button",
                    text: { type: "plain_text", text: "다음 단계로" },
                    action_id: "move_next_stage",
                    value: order.id,
                    style: "primary",
                  },
                ],
              },
            ],
          },
        ],
      })

      alertCount++
      logger.info(
        { orderId: order.id, stageName: stage.name, deadline: tomorrowStr },
        "마감 D-1 알림 발송"
      )
    }
  }

  // 오래된 로그 정리 (30일)
  await prisma.deadlineAlertLog.deleteMany({
    where: {
      sentAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
  })

  return NextResponse.json({
    status: "ok",
    alertsSent: alertCount,
    timestamp: new Date().toISOString(),
  })
}
```

- [ ] **Step 2: vercel.json에 크론 설정 추가**

`vercel.json`에 crons 항목 추가 (기존 health-monitor 패턴 참고):

```json
{
  "crons": [
    {
      "path": "/api/cron/health-monitor",
      "schedule": "*/5 * * * *"
    },
    {
      "path": "/api/cron/deadline-check",
      "schedule": "0 0 * * *"
    }
  ]
}
```

> Note: `0 0 * * *`은 UTC 자정 = KST 오전 9시

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/cron/deadline-check/route.ts vercel.json
git commit -m "feat: 마감 D-1 알림 크론 — 매일 오전 9시 SLACK_CHANNEL_OPERATION 발송"
```

---

## Phase 5: 프로필

### Task 18: `/profile` 커맨드

**Files:**
- Create: `src/lib/slack/commands/profile.ts`

- [ ] **Step 1: 프로필 커맨드 구현**

```typescript
// src/lib/slack/commands/profile.ts
import { getCsToolClient } from "@/lib/cs-tool/client"
import { getSlackClient } from "@/lib/slack/client"
import { logger } from "@/lib/logger"

export async function handleProfileCommand(text: string) {
  const trimmed = text.trim()

  if (trimmed.startsWith("수정")) {
    return searchForProfileEdit(trimmed.replace("수정", "").trim())
  }

  return listProfiles(trimmed || undefined)
}

async function listProfiles(search?: string) {
  const client = getCsToolClient()
  const result = await client.getProfiles()
  const profiles = result.data ?? []

  let filtered = profiles
  if (search) {
    filtered = profiles.filter((p) => p.name.includes(search))
  }

  if (filtered.length === 0) {
    return {
      response_type: "ephemeral",
      text: search ? `"${search}" 프로필을 찾을 수 없어요.` : "등록된 프로필이 없어요.",
    }
  }

  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: "📂 프로필 목록" } },
  ]

  for (const p of filtered) {
    const badge = p.isDefault ? " ⭐ 기본" : ""
    const skus = p.skus.length > 0 ? p.skus.join(", ") : "-"

    blocks.push(
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `📌 *${p.name}*${badge}\n   SKU: ${skus}\n   ${p.description ?? ""}`,
        },
        accessory: {
          type: "button",
          text: { type: "plain_text", text: "수정" },
          action_id: "edit_profile",
          value: p.id,
        },
      },
    )
  }

  return { response_type: "ephemeral", text: " ", blocks }
}

async function searchForProfileEdit(input: string) {
  if (!input) {
    return {
      response_type: "ephemeral",
      text: "수정할 프로필 이름을 입력해주세요.\n사용법: `/profile 수정 액자류`",
    }
  }
  return listProfiles(input)
}

export async function openProfileEditModal(triggerId: string, profileId: string) {
  const client = getCsToolClient()
  const slackClient = getSlackClient()

  const [profileResult, typesResult] = await Promise.all([
    client.getProfile(profileId),
    client.getContactTypes(),
  ])

  const profile = profileResult.data
  const types = typesResult.data ?? []
  if (!profile) return

  const typeOptions = types.map((t) => ({
    text: { type: "plain_text" as const, text: t.name },
    value: t.id,
  }))

  const initialTypes = typeOptions.filter((o) =>
    profile.contactTypeIds.includes(o.value)
  )

  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "profile_edit_modal",
      private_metadata: JSON.stringify({ profileId }),
      title: { type: "plain_text", text: "프로필 수정" },
      submit: { type: "plain_text", text: "저장" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "input",
          block_id: "name_block",
          label: { type: "plain_text", text: "이름" },
          element: {
            type: "plain_text_input",
            action_id: "name_input",
            initial_value: profile.name,
          },
        },
        {
          type: "input",
          block_id: "desc_block",
          label: { type: "plain_text", text: "설명" },
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: "desc_input",
            ...(profile.description ? { initial_value: profile.description } : {}),
          },
        },
        {
          type: "input",
          block_id: "default_block",
          label: { type: "plain_text", text: "기본 프로필" },
          optional: true,
          element: {
            type: "checkboxes",
            action_id: "default_check",
            options: [
              { text: { type: "plain_text", text: "기본 프로필로 설정" }, value: "default" },
            ],
            ...(profile.isDefault
              ? {
                  initial_options: [
                    { text: { type: "plain_text", text: "기본 프로필로 설정" }, value: "default" },
                  ],
                }
              : {}),
          },
        },
        {
          type: "input",
          block_id: "types_block",
          label: { type: "plain_text", text: "필수 연락처 타입" },
          optional: true,
          element: {
            type: "multi_static_select",
            action_id: "types_select",
            options: typeOptions,
            ...(initialTypes.length > 0 ? { initial_options: initialTypes } : {}),
          },
        },
      ],
    },
  })
}

export async function handleProfileEditSubmit(payload: any) {
  const { profileId } = JSON.parse(payload.view.private_metadata)
  const values = payload.view.state.values

  const name = values.name_block.name_input.value
  const description = values.desc_block?.desc_input?.value
  const isDefault = (values.default_block?.default_check?.selected_options?.length ?? 0) > 0
  const contactTypeIds = (values.types_block?.types_select?.selected_options ?? [])
    .map((o: any) => o.value)

  const client = getCsToolClient()
  await client.updateProfile(profileId, {
    name,
    description,
    isDefault,
    contactTypeIds,
  })

  logger.info({ profileId, name }, "프로필 수정 완료")
  return null
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/lib/slack/commands/profile.ts
git commit -m "feat: /profile 커맨드 — 목록 조회 + 수정 모달"
```

---

## Phase 6: 라우팅 통합 + 정리

### Task 19: 커맨드/액션 라우트 업데이트

**Files:**
- Modify: `src/app/api/slack/command/route.ts`
- Modify: `src/app/api/slack/action/route.ts`

- [ ] **Step 1: 커맨드 라우트에 새 커맨드 추가**

`command/route.ts`의 switch문에:

```typescript
// 새 커맨드 라우팅 추가
case "/contact-type":
  return deferCommand(responseUrl, command, () =>
    handleContactTypeCommand(text)
  )

case "/profile":
  return deferCommand(responseUrl, command, () =>
    handleProfileCommand(text)
  )

case "/operation":
  return deferCommand(responseUrl, command, () =>
    handleOperationCommand(text)
  )

// /contact 추가 → 모달 오픈 (동기)
// 기존 /contact 분기에 "추가" 서브커맨드 처리 추가
if (command === "/contact" && text.trim() === "추가") {
  await openContactAddModal(triggerId)
  return new NextResponse(null, { status: 200 })
}
```

import 추가:
```typescript
import { handleContactTypeCommand } from "@/lib/slack/commands/contact-type"
import { handleProfileCommand } from "@/lib/slack/commands/profile"
import { handleOperationCommand } from "@/lib/slack/commands/operation"
import { openContactAddModal } from "@/lib/slack/commands/contact"
```

- [ ] **Step 2: 액션 라우트에 새 액션 핸들러 추가**

`action/route.ts`에:

```typescript
// view_submission 핸들러 추가
case "contact_add_modal":
  return handleContactAddSubmit(payload)

case "contact_edit_modal":
  return handleContactEditSubmit(payload)

case "checklist_modal":
  return handleChecklistSubmit(payload)

case "stage_move_modal":
  return handleStageMoveSubmit(payload)

case "template_sms_modal":
  return validateTemplateSms(payload)

case "template_sms_confirm":
  // 컨펌 후 비동기 발송
  after(async () => { await executeTemplateSms(payload) })
  return null

case "order_contact_modal":
  return handleOrderContactSubmit(payload)

case "profile_edit_modal":
  return handleProfileEditSubmit(payload)

// block_actions 핸들러 추가
case "view_order_detail":
  // 주문 상세 ephemeral 메시지 발송
  after(async () => { ... })
  break

case "edit_contact":
  await openContactEditModal(triggerId, actionValue)
  break

case "edit_profile":
  await openProfileEditModal(triggerId, actionValue)
  break

case "assign_order_contact":
  await openOrderContactModal(triggerId, actionValue)
  break

case "open_checklist":
  await openChecklistModal(triggerId, actionValue)
  break

case "move_next_stage":
  await handleMoveNextStage(triggerId, actionValue)
  break

case "copy_template":
  after(async () => { await handleCopyTemplate(actionValue, userId, channelId) })
  break

case "send_template_sms":
  await openTemplateSendModal(triggerId, actionValue)
  break

// stage_detail_* 패턴 (동적 action_id)
if (actionId.startsWith("stage_detail_")) {
  const stageId = actionValue
  after(async () => {
    const csClient = getCsToolClient()
    const result = await csClient.getOperations({ stageId })
    const board = result.data
    if (!board) return
    const stage = board.stages.find((s) => s.id === stageId)
    if (!stage) return
    const message = buildStageDetailMessage(stage)
    await postToResponseUrl(responseUrl, message)
  })
}
```

import 추가:
```typescript
import { handleContactAddSubmit, handleContactEditSubmit, openContactEditModal, openContactAddModal } from "@/lib/slack/commands/contact"
import { openChecklistModal, handleChecklistSubmit } from "@/lib/slack/actions/checklist"
import { handleMoveNextStage, handleStageMoveSubmit } from "@/lib/slack/actions/stage-move"
import { handleCopyTemplate, openTemplateSendModal, validateTemplateSms, executeTemplateSms } from "@/lib/slack/actions/template-send"
import { openOrderContactModal, handleOrderContactSubmit } from "@/lib/slack/actions/order-contact"
import { openProfileEditModal, handleProfileEditSubmit } from "@/lib/slack/commands/profile"
```

- [ ] **Step 3: 빌드 확인**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 커밋**

```bash
git add src/app/api/slack/command/route.ts src/app/api/slack/action/route.ts
git commit -m "feat: 커맨드/액션 라우트 — 새 커맨드 + 액션 핸들러 통합"
```

---

### Task 20: 정리 + 빌드 검증

**Files:**
- 전체 빌드 검증

- [ ] **Step 1: 전체 빌드**

```bash
npx tsc --noEmit
npm run build
```

Expected: 에러 없이 빌드 성공. Contact 관련 Prisma 참조가 남아있으면 수정.

- [ ] **Step 2: 남은 Contact DB 참조 검색 + 제거**

```bash
# prisma.contact 사용처 검색
grep -r "prisma.contact" src/ --include="*.ts"
```

남아있는 참조가 있으면 제거/교체.

- [ ] **Step 3: 사용하지 않는 import 정리**

빌드 에러나 unused import 경고 확인 후 정리.

- [ ] **Step 4: 최종 빌드 확인**

```bash
npm run build
```

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "chore: Contact DB 참조 제거 + 빌드 정리"
```

---

## 요약

| Phase | Task | 내용 |
|---|---|---|
| 1 Foundation | 1-3 | 타입 확장, API 클라이언트, DB 마이그레이션 |
| 2 연락처 | 4-8 | 드롭다운, /contact, /contact-type, SMS 웹훅, SMS 커맨드 |
| 3 주문 | 9-13 | 상세 빌더, 조회, 모달 확장, 연락처 배정, 템플릿 SMS |
| 4 오퍼레이션 | 14-17 | 칸반 뷰, 체크리스트, 단계 이동, 마감 크론 |
| 5 프로필 | 18 | /profile 커맨드 |
| 6 통합 | 19-20 | 라우팅, 빌드 검증, 정리 |
