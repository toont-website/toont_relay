# CS Tool API 명세 — Relay가 기대하는 스펙

> Base URL: `CS_TOOL_API_URL` (env)
> Auth: `Authorization: Bearer {CS_TOOL_API_KEY}`
> 응답 공통: `{ success: boolean, data?: T, error?: { code, message }, meta?: { total, page, limit } }`

---

## 1. 주문

### `GET /api/v1/orders`
주문 목록 조회 (페이지네이션)

| Query Param | 타입 | 필수 | 설명 |
|---|---|---|---|
| `status` | string | X | `pending` / `in_progress` / `completed` / `cancelled` |
| `customer` | string | X | 고객명 검색 |
| `page` | string | X | 페이지 (기본 1) |
| `limit` | string | X | 건수 (기본 5) |
| `from` | string | X | 시작일 |
| `to` | string | X | 종료일 |

**응답 `data: Order[]`** + `meta: { total, page, limit }`

### `GET /api/v1/orders/:id`
주문 상세

**응답 `data: Order`**

```typescript
Order {
  id: string (UUID)
  orderId?: string              // 구매경로 (자사몰, 네이버 등)
  customerName: string
  itemDescription: string | null // 주문내용 (직접 입력 텍스트)
  productNames: string | null    // SKU 상품명 (쉼표 구분)
  quantity: number
  phone: string
  sku: string | null
  skus: string[]
  skuQuantities: Record<string, number>  // { "SKU-001": 2, "SKU-002": 1 }
  address?: string
  status: string                // pending / in_progress / completed / cancelled
  dueDate?: string              // YYYY-MM-DD
  channel?: string
  notes?: string
  progress?: number             // 0~100
  currentStageId?: string
  currentStageName?: string
  profileId: string | null
  profileName: string | null
  stageEnteredAt: string | null  // ISO 8601
  stageDeadline: string | null   // YYYY-MM-DD
  templateVariables: Record<string, unknown>
  contacts: OrderContact[]
  requiredContactTypes: RequiredContactType[]
  currentStageTemplates: StageTemplate[]
  checklistStatus: ChecklistStatus[]
  createdAt: string              // ISO 8601
  updatedAt: string
}

OrderContact {
  type: string         // contact type slug (customer, freight 등)
  typeName: string     // "고객", "화물/배차"
  name: string
  phone: string
}

RequiredContactType {
  id: string
  slug: string         // "customer", "freight"
  name: string         // "고객", "화물/배차"
}

StageTemplate {
  contactType: string      // contact type slug
  contactTypeName: string  // "고객"
  label: string            // "주문 접수 안내"
  text: string             // 템플릿 본문 (변수 치환된 상태)
}

ChecklistStatus {
  stageId: string
  stageName: string
  complete: boolean
  items: ChecklistItem[]
}

ChecklistItem {
  id: string
  type: "checkbox" | "text"
  label: string
  checked?: boolean    // checkbox 타입
  value?: string       // text 타입
}
```

### `POST /api/v1/orders`
주문 생성

**요청 Body:**
```json
{
  "customerName": "강동현",          // 필수
  "itemDescription": "300x300 캔버스", // 필수
  "quantity": 3,                      // 필수
  "phone": "010-9533-7464",           // 필수
  "skus": ["CANVAS-300", "WOOD-800"], // 선택
  "skuQuantities": {"CANVAS-300": 2}, // 선택
  "address": "서울시 강남구",          // 선택
  "channel": "자사몰",                // 선택
  "dueDate": "2026-04-01",            // 선택
  "shipDate": "2026-03-28",           // 선택
  "notes": "급한 주문",               // 선택
  "profileId": "uuid",                // 선택
  "customerContactId": "uuid",        // 선택 — 고객 연락처 배정
  "freightContactId": "uuid",         // 선택 — 화물/배차 배정
  "progress": "0"                     // 선택
}
```

**응답 `data: CreateOrderResponse`**
```typescript
{
  order: Order,
  inventory?: {
    deducted: boolean,
    remaining: number | null,
    warning: string | null
  }
}
```

### `PATCH /api/v1/orders/:id`
주문 수정

**요청 Body (부분 업데이트):**
```json
{
  "status": "completed",
  "notes": "메모 수정",
  "templateVariables": {
    "__stage_checklists": {
      "<stageId>": {
        "<itemId>": { "checked": true },
        "<itemId>": { "value": "텍스트 입력값" }
      }
    }
  }
}
```

> ⚠️ 체크리스트 저장은 `templateVariables.__stage_checklists` 형식으로 전송

---

## 2. 주문 연락처

### `GET /api/v1/orders/:orderId/contacts`
주문에 배정된 연락처 목록

**응답 `data: OrderContact[]`**

### `POST /api/v1/orders/:orderId/contacts`
연락처 배정

**요청:** `{ "contactId": "uuid" }`

> 연락처의 typeSlug에 맞는 주문 연락처 슬롯에 자동 배정
> 타입 불일치 시 422 / `CONTACT_TYPE_MISMATCH` 에러

### `DELETE /api/v1/orders/:orderId/contacts/:contactTypeId`
연락처 배정 해제

---

## 3. 재고

### `GET /api/v1/inventory`
재고 목록

| Query Param | 타입 | 설명 |
|---|---|---|
| `category` | string | 카테고리 필터 |
| `low_stock` | string | `"true"` → 부족 항목만 |

**응답 `data: InventoryItem[]`**

```typescript
InventoryItem {
  id: string
  orgId: string
  name: string        // "캔버스 액자 300"
  sku: string         // "CANVAS-300"
  quantity: number
  minQuantity: number  // 최소 기준
  unit: string         // "개", "장" 등
  category?: string
  price: number | null
  notes: string | null
  isLowStock: boolean
}
```

### `GET /api/v1/inventory/:sku`
SKU 상세 + 최근 로그

**응답 `data: { item: InventoryItem, recentLogs: InventoryLog[] }`**

### `POST /api/v1/inventory/inbound`
입고

**요청:** `{ "sku": "CANVAS-300", "quantity": 10, "reason": "발주 입고" }`

### `POST /api/v1/inventory/outbound`
출고

**요청:** `{ "sku": "CANVAS-300", "quantity": 5, "reason": "주문 출고", "orderId": "uuid" }`

---

## 4. 오퍼레이션

### `GET /api/v1/operations`
칸반 보드 (단계별 주문 목록)

| Query Param | 타입 | 설명 |
|---|---|---|
| `stageId` | string | 특정 단계만 |
| `status` | string | 주문 상태 필터 |

**응답 `data: OperationBoard`**
```typescript
{
  stages: [{
    id: string,
    name: string,       // "접수", "제작" 등
    position: number,    // 0부터
    color: string,       // "blue", "yellow" 등
    orders: Order[]      // 해당 단계의 주문 목록
  }]
}
```

### `PATCH /api/v1/operations/:orderId/status`
단계 이동

**요청:**
```json
{
  "stageId": "uuid",            // 이동할 단계 ID
  "stageDeadline": "2026-04-01", // 선택
  "skipChecklist": true          // 체크리스트 미완료 시
}
```

---

## 5. 연락처

### `GET /api/v1/contacts`
연락처 검색

| Query Param | 타입 | 설명 |
|---|---|---|
| `type` | string | 타입 slug 필터 (`customer`, `freight` 등) |
| `search` | string | 이름 또는 번호 검색 |
| `page` | string | 페이지 |
| `limit` | string | 건수 (기본 10) |

**응답 `data: CsContact[]`**

```typescript
CsContact {
  id: string
  orgId: string
  typeId: string
  typeName: string     // "고객"
  typeSlug: string     // "customer"
  name: string
  phone: string
  memo: string | null
  address: string | null
  createdAt: string
  updatedAt: string
}
```

> ⚠️ `search` 미전송 시 (빈 문자열) → 전체 목록 반환 (limit 적용)

### `GET /api/v1/contacts/:id`
연락처 상세

### `POST /api/v1/contacts`
연락처 생성

**요청:** `{ "name": "강동현", "typeId": "uuid", "phone": "010-1234-5678", "address": "서울시", "memo": "메모" }`

### `PATCH /api/v1/contacts/:id`
연락처 수정

**요청:** (부분 업데이트) `{ "name": "수정", "phone": "010-0000-0000", "address": "변경", "memo": "변경" }`

### `DELETE /api/v1/contacts/:id`
연락처 삭제

---

## 6. 연락처 타입

### `GET /api/v1/contact-types`
타입 목록

**응답 `data: ContactType[]`**

```typescript
ContactType {
  id: string
  orgId: string
  name: string       // "고객", "화물/배차"
  slug: string       // "customer", "freight"
  isDefault: boolean
  createdAt: string
}
```

### `POST /api/v1/contact-types`
타입 추가

**요청:** `{ "name": "원단업체", "slug": "fabric" }`

> 중복 slug → 409 Conflict

### `DELETE /api/v1/contact-types/:id`
타입 삭제

> 기본 타입 삭제 시 → 403 Forbidden

---

## 7. 프로필

### `GET /api/v1/profiles`
프로필 목록

**응답 `data: Profile[]`**

```typescript
Profile {
  id: string
  orgId: string
  name: string                    // "표준 제작"
  description: string | null
  isDefault: boolean
  contactTypeIds: string[]
  skus: string[]                  // ["CANVAS-300"]
  skuNames?: string[]             // ["캔버스 액자 300"]
  contactTypeNames?: string[]     // ["고객", "화물/배차"]
  variableHints: Record<string, string>
  createdAt: string
  updatedAt: string
}
```

### `GET /api/v1/profiles/:id`
프로필 상세

### `PATCH /api/v1/profiles/:id`
프로필 수정

**요청:** `{ "name": "수정", "description": "설명 변경" }`

### `GET /api/v1/profiles/match?skus=SKU1,SKU2`
SKU 기반 프로필 매칭

**응답 `data: ProfileMatchResponse`**
```typescript
{
  profiles: Profile[],    // 매칭된 프로필들 (중복 제거)
  skus: string[],
  matchCount: number
}
```

---

## 8. 단계

### `GET /api/v1/stages`
단계 목록

**응답 `data: Stage[]`**

```typescript
Stage {
  id: string
  name: string          // "접수", "제작", "배송"
  position: number      // 0부터, 오름차순
  color: string
  defaultDays: number   // 기본 소요일
  requiredItems: StageRequiredItem[]
}

StageRequiredItem {
  id: string
  type: "checkbox" | "text"
  label: string
}
```

---

## 9. 웹훅 이벤트 (CS Tool → Relay)

> Endpoint: `POST /api/webhook/cs-tool`
> 인증: HMAC-SHA256 서명 (`X-Webhook-Signature` 헤더)

### 공통 페이로드

```json
{
  "event": "order.created",
  "data": { ... },
  "timestamp": "2026-03-27T10:00:00Z"
}
```

### `order.created`
```json
{
  "event": "order.created",
  "data": {
    "order": { Order 객체 }
  }
}
```

### `order.stage_changed`
```json
{
  "event": "order.stage_changed",
  "data": {
    "order": { Order 객체 },
    "changes": {
      "previousStageName": "접수",
      "currentStageName": "제작"
    }
  }
}
```

### `order.deadline_changed`
```json
{
  "event": "order.deadline_changed",
  "data": {
    "order": { Order 객체 },
    "changes": {
      "stageName": "제작",
      "previousDeadline": "2026-03-25T00:00:00Z",
      "newDeadline": "2026-03-28T00:00:00Z",
      "source": "google_calendar"
    }
  }
}
```

### `order.status_changed`
```json
{
  "event": "order.status_changed",
  "data": {
    "order": { Order 객체 },
    "changes": {
      "previousStatus": "in_progress",
      "currentStatus": "completed"
    }
  }
}
```

### `inventory.updated`
```json
{
  "event": "inventory.updated",
  "data": {
    "item": { InventoryItem 객체 },
    "change": {
      "type": "inbound",
      "quantity": 10,
      "reason": "발주 입고"
    }
  }
}
```

### `inventory.low_stock`
```json
{
  "event": "inventory.low_stock",
  "data": {
    "item": { InventoryItem 객체 }
  }
}
```

---

## 10. 크론 (Relay 내부)

### `GET /api/cron/deadline-check`
내일 마감 주문 알림 (매일 오전 실행)

> `Authorization: Bearer {CRON_SECRET}` 필요

### `GET /api/cron/health-monitor`
헬스 체크

---

## 현재 미사용 / 향후 필요 가능성

| 엔드포인트 | 현재 상태 | 비고 |
|---|---|---|
| `DELETE /api/v1/orders/:id` | 미사용 | 주문 삭제 기능 없음 |
| `PUT /api/v1/profiles/:id` | 미사용 | PATCH로 충분 |
| `GET /api/v1/orders/:id/contacts` | 구현됨 | 사용처 적음 (Order에 contacts 포함) |
