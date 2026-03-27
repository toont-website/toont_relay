# 주문 등록 모달 전면 개편 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주문 등록 모달을 연락처 select search, 복수 SKU 프로필 합산, 배송지 자동 매핑, 폼 순서 재배치로 전면 개편한다.

**Architecture:** 기존 order.ts의 모달 로직을 전면 재작성. 옵션 로드에 action_id 기반 라우팅 추가. CS Tool API의 `GET /profiles/match?skus=` 엔드포인트와 `customerContactId`/`freightContactId` 필드 활용.

**Tech Stack:** Next.js 16, Slack Web API (@slack/web-api), CS Tool REST API

**Spec:** `docs/superpowers/specs/2026-03-27-order-modal-redesign.md`

---

## 파일 구조

### 수정 파일

| 파일 | 변경 |
|---|---|
| `src/lib/cs-tool/types.ts` | `CreateOrderParams`에 `customerContactId`/`freightContactId`/`shipDate`/`progress` 추가 |
| `src/lib/cs-tool/client.ts` | `getProfilesBySkus(skus)` 메서드 추가 |
| `src/lib/slack/options/cs-contacts.ts` | 타입별 검색 지원 (`type` 파라미터) |
| `src/app/api/slack/options/route.ts` | `action_id` 기반 라우팅 |
| `src/lib/slack/commands/order.ts` | 모달 전면 재작성 |
| `src/app/api/slack/command/route.ts` | `/order 추가` 분기 추가 |
| `src/app/api/slack/action/route.ts` | 새 block_actions 핸들러 추가 |

---

## Task 1: 타입 + API 클라이언트 확장

**Files:**
- Modify: `src/lib/cs-tool/types.ts`
- Modify: `src/lib/cs-tool/client.ts`

- [ ] **Step 1: CreateOrderParams 확장**

`CreateOrderParams`에 추가:
```typescript
customerContactId?: string
freightContactId?: string
shipDate?: string
progress?: string
```

- [ ] **Step 2: ProfileMatchResponse 타입 추가**

```typescript
export interface ProfileMatchResponse {
  profiles: Profile[]
  skus: string[]
  matchCount: number
}
```

- [ ] **Step 3: client.ts에 getProfilesBySkus 메서드 추가**

```typescript
async getProfilesBySkus(skus: string[]): Promise<CsToolResponse<ProfileMatchResponse>> {
  return this.request<ProfileMatchResponse>(
    "GET",
    "/profiles/match",
    undefined,
    { skus: skus.join(",") }
  )
}
```

- [ ] **Step 4: 빌드 확인 + 커밋**

```bash
npx tsc --noEmit
git commit -m "feat: CreateOrderParams 확장 + getProfilesBySkus API 메서드"
```

---

## Task 2: 옵션 로드 — 타입별 연락처 검색

**Files:**
- Modify: `src/lib/slack/options/cs-contacts.ts`
- Modify: `src/app/api/slack/options/route.ts`

- [ ] **Step 1: cs-contacts.ts에 타입 파라미터 추가**

`searchContacts` 함수에 `contactType` 파라미터 추가:

```typescript
export async function searchContacts(query: string, contactType?: string) {
  const client = getCsToolClient()
  const result = await client.getContacts({
    ...(contactType ? { type: contactType } : {}),
    ...(query.trim() ? { search: query } : {}),
    limit: 10,
  })
  // ... 기존 로직 동일
}
```

빈 쿼리(`min_query_length: 0`)일 때도 기본 10개 반환.

- [ ] **Step 2: options route에 action_id 라우팅**

```typescript
const actionId = payload.action_id ?? ""
let contactType: string | undefined

if (actionId === "customer_contact_select") {
  contactType = "customer"
} else if (actionId === "freight_contact_select") {
  contactType = "freight"
}

const result = await searchContacts(query, contactType)
```

- [ ] **Step 3: 빌드 확인 + 커밋**

```bash
npx tsc --noEmit
git commit -m "feat: 연락처 옵션 — action_id 기반 타입별 검색 + 빈 쿼리 지원"
```

---

## Task 3: 주문 등록 모달 재작성

**Files:**
- Modify: `src/lib/slack/commands/order.ts`

이 태스크가 가장 큼. `handleOrderCreateCommand`, `handleProductSelect`, `handleProfileSelect`, `validateOrderAdd`, `executeOrderAdd` 전부 재작성.

- [ ] **Step 1: handleOrderCreateCommand 재작성**

모달 오픈 시:
1. `GET /inventory` (상품 목록)
2. 모달 블록 구성 (새 폼 순서):

```typescript
blocks = [
  // 1. 주문자 (external_select, 필수)
  {
    type: "input",
    block_id: "customer_block",
    label: { type: "plain_text", text: "주문자" },
    element: {
      type: "external_select",
      action_id: "customer_contact_select",
      placeholder: { type: "plain_text", text: "고객 검색..." },
      min_query_length: 0,
    },
    dispatch_action: true,
  },
  // 2. 화물/배차 (external_select, 선택)
  {
    type: "input",
    block_id: "freight_block",
    label: { type: "plain_text", text: "화물/배차" },
    optional: true,
    element: {
      type: "external_select",
      action_id: "freight_contact_select",
      placeholder: { type: "plain_text", text: "화물/배차 검색..." },
      min_query_length: 0,
    },
  },
  // 3. 구매경로 (text, 선택)
  {
    type: "input",
    block_id: "channel_block",
    label: { type: "plain_text", text: "구매경로" },
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: "channel_input",
      placeholder: { type: "plain_text", text: "자사몰, 네이버 등" },
    },
  },
  // 4. 상품 (multi_static_select, 선택)
  {
    type: "input",
    block_id: "product_block",
    label: { type: "plain_text", text: "상품" },
    optional: true,
    hint: { type: "plain_text", text: "상품 선택 후 수량 입력칸이 나타날 때까지 잠시 기다려주세요" },
    element: {
      type: "multi_static_select",
      action_id: "product_select",
      placeholder: { type: "plain_text", text: "상품 선택 (복수 가능)" },
      options: productOptions.slice(0, 100),
    },
    dispatch_action: true,
  },
  // 5. 주문내용 (text, 선택)
  {
    type: "input",
    block_id: "description_block",
    label: { type: "plain_text", text: "주문내용" },
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: "description_input",
      multiline: true,
    },
  },
  // 6. 수령지 주소 (text, 선택)
  {
    type: "input",
    block_id: "address_block",
    label: { type: "plain_text", text: "수령지 주소" },
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: "address_input",
    },
  },
  // 7. 완료예정일
  {
    type: "input",
    block_id: "due_block",
    label: { type: "plain_text", text: "완료예정일" },
    optional: true,
    element: { type: "datepicker", action_id: "due_picker" },
  },
  // 8. 발송예정일
  {
    type: "input",
    block_id: "ship_block",
    label: { type: "plain_text", text: "발송예정일" },
    optional: true,
    element: { type: "datepicker", action_id: "ship_picker" },
  },
  // 9. 진행률
  {
    type: "input",
    block_id: "progress_block",
    label: { type: "plain_text", text: "진행률" },
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: "progress_input",
      placeholder: { type: "plain_text", text: "0~100" },
    },
  },
  // 10. 메모
  {
    type: "input",
    block_id: "notes_block",
    label: { type: "plain_text", text: "메모" },
    optional: true,
    element: {
      type: "plain_text_input",
      action_id: "notes_input",
      multiline: true,
    },
  },
]
```

private_metadata: `JSON.stringify({})` (초기에는 빈 객체)

- [ ] **Step 2: handleProductSelect 재작성**

상품 선택 시:
1. 선택된 SKU 목록 추출
2. `GET /profiles/match?skus=` 호출
3. 프로필 매칭 결과에 따라 모달 갱신:
   - 0개: 프로필 블록 없음
   - 1개: context 블록으로 "프로필: XXX 자동 적용"
   - 2개+: static_select 드롭다운
4. 화물 필수 여부 판단 (프로필의 requiredContactTypes)
5. SKU별 수량 필드 추가
6. `views.update` (hash 불일치 시 warn 로그만)

기존 입력값 보존: `view.state.values`에서 현재 값 읽어서 재설정.
metadata 크기 체크: 2900바이트 초과 시 프로필 데이터 축소.

- [ ] **Step 3: customer_contact_select block_actions 핸들러**

주문자 선택 시:
1. option value JSON parse → `{ id, name, phone, address }`
2. address가 있으면 주소 필드 자동 채움 (`views.update`)
3. metadata에 `customerContactId`, `customerName`, `customerPhone` 저장

- [ ] **Step 4: freight_contact_select block_actions 핸들러**

화물 선택 시:
1. metadata에 `freightContactId` 저장

기존 `handleProfileSelect`도 유지 (프로필 드롭다운 선택 시).

- [ ] **Step 5: validateOrderAdd 재작성**

```typescript
interface ValidatedOrderAdd {
  customerName: string
  phone: string
  address?: string
  channel?: string
  skus: string[]
  skuQuantities: Record<string, number>
  itemDescription?: string
  quantity: number
  dueDate?: string
  shipDate?: string
  progress?: string
  notes?: string
  profileId?: string
  customerContactId?: string
  freightContactId?: string
}
```

검증:
- 주문자 필수 (customer_block에서 selected_option 확인)
- 주문자 value JSON parse → name, phone, id 추출
- 화물: 선택됐으면 value JSON parse
- 상품: 선택됐으면 SKU별 수량 추출 (qty_{sku} 블록), 없으면 기본값 1
- metadata에서 profileId 읽기
- 화물 필수인데 미선택 → 에러

- [ ] **Step 6: executeOrderAdd 재작성**

```typescript
const result = await client.createOrder({
  customerName: data.customerName,
  phone: data.phone,
  address: data.address,
  channel: data.channel,
  skus: data.skus,
  skuQuantities: data.skuQuantities,
  itemDescription: data.itemDescription,
  quantity: data.quantity,
  dueDate: data.dueDate,
  shipDate: data.shipDate,
  notes: data.notes,
  profileId: data.profileId,
  customerContactId: data.customerContactId,
  freightContactId: data.freightContactId,
})
```

별도 `POST /orders/{id}/contacts` 호출 제거.

- [ ] **Step 7: 빌드 확인 + 커밋**

```bash
npx tsc --noEmit
git commit -m "feat: 주문 등록 모달 전면 재작성 — 연락처 select, 프로필 합산, 폼 재배치"
```

---

## Task 4: 커맨드/액션 라우트 업데이트

**Files:**
- Modify: `src/app/api/slack/command/route.ts`
- Modify: `src/app/api/slack/action/route.ts`

- [ ] **Step 1: /order 추가 분기**

command/route.ts에서:
```typescript
// /order 추가 → 모달 오픈 (기존 /order-add와 동일)
if (command === "/order" && text.trim() === "추가") {
  const response = await handleOrderCreateCommand(triggerId)
  if (response) return NextResponse.json(response)
  return new NextResponse(null, { status: 200 })
}
```

기존 `/order-add` 분기는 하위호환으로 유지.

- [ ] **Step 2: 새 block_actions 핸들러**

action/route.ts에 추가:
```typescript
if (actionId === "customer_contact_select") {
  after(async () => {
    try {
      await handleCustomerContactSelect(payload)
    } catch (error) {
      logger.error({ error }, "주문자 선택 처리 실패")
    }
  })
  return new NextResponse(null, { status: 200 })
}

if (actionId === "freight_contact_select") {
  after(async () => {
    try {
      await handleFreightContactSelect(payload)
    } catch (error) {
      logger.error({ error }, "화물 선택 처리 실패")
    }
  })
  return new NextResponse(null, { status: 200 })
}
```

import 추가: `handleCustomerContactSelect`, `handleFreightContactSelect` from order.ts

- [ ] **Step 3: 빌드 확인 + 커밋**

```bash
npx tsc --noEmit
git commit -m "feat: /order 추가 분기 + 연락처 select block_actions 핸들러"
```

---

## Task 5: 통합 빌드 검증 + 정리

- [ ] **Step 1: 전체 빌드**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: 기존 코드 정리**

- `handleOrderCreateCommand`에서 기존 고객명/전화번호 텍스트 input 코드 제거 확인
- `executeOrderAdd`에서 `POST /orders/{id}/contacts` 별도 호출 제거 확인
- 미사용 import 정리

- [ ] **Step 3: 최종 커밋**

```bash
git commit -m "chore: 주문 등록 모달 — 미사용 코드 정리"
```
