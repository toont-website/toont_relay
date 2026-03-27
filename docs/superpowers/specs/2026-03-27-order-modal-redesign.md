# 주문 등록 모달 전면 개편 설계

**작성일**: 2026-03-27
**상태**: 확정

---

## 개요

`/order-add` 모달을 전면 개편한다. 연락처를 텍스트 입력에서 select search로 변경하고, 복수 SKU 프로필 합산 매칭, 배송지 자동 매핑, 폼 순서 재배치, race condition 대응을 포함한다.

### 변경 범위

- `/order-add` 커맨드 → `/order 추가`로 통합
- 고객/화물 연락처: 텍스트 입력 → `external_select` (CS Tool API 연락처 검색)
- `customerContactId`/`freightContactId` API 직접 전송 (별도 contacts 배정 호출 불필요)
- 복수 SKU → `GET /profiles/match?skus=` API로 프로필 합산 매칭
- 고객 선택 시 배송지 자동 채움
- 상품 선택 race condition 대응
- 구매경로/진행률 필드 추가

---

## 폼 구조

```
1. 주문자 (external_select, 필수) — GET /contacts?type=customer
2. 화물/배차 (external_select, 기본 선택/프로필 매칭 시 필수) — GET /contacts?type=freight
3. 구매경로 (text input, 선택)
4. 상품 (multi_static_select, 선택) — GET /inventory
   └ [SKU별 수량 입력] (동적 추가, 기본값 1)
   └ help text: "상품 선택 후 수량 입력칸이 나타날 때까지 잠시 기다려주세요"
5. 주문내용 (text input, 선택)
6. 수령지 주소 (text input, 선택) — 주문자 선택 시 자동 채움
7. 완료예정일 (datepicker, 선택)
8. 발송예정일 (datepicker, 선택)
9. 진행률 (text input, 선택)
10. 메모 (text input, 선택)
```

### 연락처 필드

- **주문자**: 항상 표시, 항상 필수. `external_select` + `min_query_length: 0` (빈 쿼리 시 최근 10개 표시)
- **화물/배차**: 항상 표시, 기본 `optional: true`. 프로필 매칭 결과 `requiredContactTypes`에 화물 타입 있으면 `optional: false`로 전환

### 연락처 select 값

option value: `JSON.stringify({ id: contact.id, name: contact.name, phone: contact.phone, address: contact.address })`

---

## 동적 동작

### 주문자(고객) 선택 시 (`block_actions`)

1. 선택된 option value에서 address 추출 (JSON parse)
2. 수령지 주소 필드에 자동 채움 (`views.update`)
3. `private_metadata`에 `customerContactId`, `customerName`, `customerPhone` 저장

### 화물/배차 선택 시 (`block_actions`)

1. `private_metadata`에 `freightContactId` 저장

### 상품 선택 시 (`block_actions`)

1. 선택된 SKU 목록으로 `GET /profiles/match?skus=SKU1,SKU2` 호출
2. 프로필 매칭 결과:
   - 0개: 기본 프로필 적용 (드롭다운 없음)
   - 1개: 자동 선택 (context 블록으로 표시)
   - 2개+: 프로필 선택 `static_select` 드롭다운 추가
3. 프로필의 `requiredContactTypes`에 화물 타입 있으면 → 화물 필드 `optional: false`로 전환
4. SKU별 수량 입력 필드 동적 추가 (기존 값 보존)
5. `views.update` (hash 불일치 시 로그만 남기고 무시)

---

## 제출 처리

### 검증 (`validateOrderAdd`)

- 주문자 필수 (선택 안 했으면 에러)
- 주문자 option value JSON parse → customerContactId, name, phone 추출
- 화물: 프로필에서 필수면 체크, 아니면 선택 (있으면 freightContactId 추출)
- 상품 선택됐으면 각 SKU 수량 추출 (`qty_{sku}` 블록). 없으면 기본값 1
- 수량 검증 (양수 정수)

### 실행 (`executeOrderAdd`)

```json
POST /orders {
  "customerName": "연락처 이름",
  "phone": "연락처 전화번호",
  "address": "수령지 주소값",
  "channel": "구매경로값",
  "skus": ["SKU1", "SKU2"],
  "skuQuantities": { "SKU1": 2, "SKU2": 1 },
  "itemDescription": "주문내용",
  "quantity": 3,
  "dueDate": "완료예정일",
  "shipDate": "발송예정일",
  "notes": "메모",
  "profileId": "선택된 프로필 UUID",
  "customerContactId": "주문자 연락처 UUID",
  "freightContactId": "화물 연락처 UUID"
}
```

기존 `POST /orders/{id}/contacts` 별도 호출 불필요 (API가 한 번에 처리).

---

## 옵션 로드 (`options/route.ts`)

`action_id` 기반 라우팅 추가:

| action_id | API 호출 | 비고 |
|---|---|---|
| `customer_contact_select` | `GET /contacts?type=customer&search={query}&limit=10` | 빈 쿼리 시 전체 10개 |
| `freight_contact_select` | `GET /contacts?type=freight&search={query}&limit=10` | 빈 쿼리 시 전체 10개 |
| `contact_select*` (기존) | `GET /contacts?search={query}&limit=10` | SMS 등 기존 용도 |

---

## Race Condition 대응

- `views.update` 호출 시 `hash` 전달
- hash 불일치(409/error) → `logger.warn`만 남기고 무시 (크래시 방지)
- 상품 선택 영역 help text: "상품 선택 후 수량 입력칸이 나타날 때까지 잠시 기다려주세요"
- 제출 시 `view.state.values` 기준으로 최종 상태 반영 (중간 업데이트 씹혀도 문제 없음)
- 수량 필드 없는 SKU → 기본값 1

---

## 커맨드 변경

- `/order-add` 슬래시 커맨드 제거 (슬랙 앱 설정에서)
- `/order 추가` 입력 시 모달 오픈하도록 `command/route.ts` 분기 추가
- 기존 `/order-add` 라우팅은 하위호환으로 당분간 유지

---

## 파일 변경

| 파일 | 변경 |
|---|---|
| `src/lib/slack/commands/order.ts` | 모달 전면 재작성 (폼 구조, 동적 동작, 검증/실행) |
| `src/lib/slack/options/cs-contacts.ts` | 타입별 검색 지원 (action_id 기반) |
| `src/app/api/slack/options/route.ts` | action_id 라우팅 추가 |
| `src/app/api/slack/command/route.ts` | `/order 추가` 분기 추가 |
| `src/app/api/slack/action/route.ts` | 새 block_actions 핸들러 (customer_contact_select, freight_contact_select) |
| `src/lib/cs-tool/client.ts` | `getProfilesBySkus(skus)` 메서드 추가 |
| `src/lib/cs-tool/types.ts` | `CreateOrderParams`에 customerContactId/freightContactId 추가 |
