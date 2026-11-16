# 렌탈 일반 문의 슬랙 알림 — 변경 기록 (relay)

- 날짜: 2026-11-16
- 브랜치: `feat/rental-inquiry-message` (main `3f28b49`에서 시작). 커밋·push·PR·배포 하지 않음.
- 운영자 결정(2026-11-16): "문의용 슬랙 채널을 CS의 슬랙 알림 탭에서 따로 설정할 수 있게. 이상 접수와 분리."
- 짝이 되는 CS 변경: toont-cs 브랜치 `feat/rental-inquiry-slack`, 문서 `docs/superpowers/plans/2026-11-16-rental-inquiry-slack-change-log.md`.

## 구조 전 → 후

전: `POST /api/webhook/cs-tool`이 `rental.issue_reported`를 받으면 CS가 준 채널에 "렌탈 이상 접수" 글과 사진을 올리고 [답변하기] 버튼을 붙인다. 모르는 사건은 운영 서명이 맞으면 아무것도 올리지 않고 `{ ok: true }`로 답한다.

후: 새 사건 `rental.inquiry_reported`를 받는다.

- 서명·출처 규칙은 이상 접수와 같다(운영 비밀값이면 운영, 스테이징 비밀값이면 스테이징).
- 채널은 CS가 본문에 준 `channelId`("렌탈 문의" 설정)다. 없으면 `{ ok: true, skipped: true, reason: "NO_CHANNEL" }`. 스테이징에서 온 것은 `SLACK_CHANNEL_STAGING_TEST`에만 올리고 "[스테이징 시험]"을 붙인다.
- 글: 제목 "렌탈 문의", 예약번호·주문번호·고객 이름과 연락처·대여 기간·행사·설치 장소, "문의 내용"(받은 시각, 본문), 첨부가 있으면 "첨부 N개를 이어서 올립니다.", 맨 아래 "CS 화면(렌탈 관리 › 주문 관리)에서 답변해 주세요. 스레드 댓글은 고객에게 가지 않습니다."
- [답변하기] 버튼은 없다. 그 버튼은 이상 접수 답변 경로로만 가고 문의 글에는 쓸 수 없기 때문이다.
- 첨부는 글의 스레드에 이어서 올린다. 같은 글을 다시 받으면 다시 올리지 않고, 첨부에서 멈추면 올린 자리를 돌려준다(이상 접수와 같은 코드).
- 이상 접수 글에는 CS 예약으로 가는 링크가 없어서 문의 글에도 넣지 않았다.

이상 접수 글은 글자와 블록이 전과 같다. 변경 전 코드에서 찍은 결과를 시험에 그대로 넣어 고정했다.

## 바뀐 파일 (`git status`와 대조: 수정 3, 새 파일 1)

| 파일 | 전 → 후 |
|---|---|
| `src/lib/rental-issue/relay.ts:8, 12` | 머리 주석 한 줄, `RENTAL_INQUIRY_EVENT = "rental.inquiry_reported"` |
| `src/lib/rental-issue/relay.ts:53-58` | `rentalInquiryPayload`(이상 접수 본문에서 `thread`를 빼고 `message`를 `{ id, body, createdAt }`로) |
| `src/lib/rental-issue/relay.ts:77-85, 101` | 예약 정보 칸을 `bookingFields`로 뽑아 두 글이 같이 쓴다. 이상 접수 글의 결과는 같다 |
| `src/lib/rental-issue/relay.ts:109-124` | `buildRentalInquiryMessage` 추가 |
| `src/lib/rental-issue/relay.ts:154-162, 173` | `handleRentalIssueReported`의 몸통을 `postReported(data, origin, deps, build)`로 옮김. 달라진 것은 글을 만드는 함수를 인자로 받는 것뿐 |
| `src/lib/rental-issue/relay.ts:198-206` | `handleRentalIssueReported`(전과 같은 동작), `handleRentalInquiryReported` 추가 |
| `src/app/api/webhook/cs-tool/route.ts:6, 9, 12, 77-90` | `rental.inquiry_reported` 갈래 추가 |
| `src/lib/rental-issue/__tests__/relay.test.ts` | 이상 접수 글 고정 시험 1개, 문의 시험 5개 추가 |
| `docs/2026-11-16-rental-inquiry-slack-change-log.md` (새 파일) | 이 문서 |

## 확인한 것

- `vitest run`(= `pnpm test`의 내용. 이 폴더에 pnpm이 없어 `node_modules/.bin/vitest run`으로 실행): 63개 중 62 통과, 1 실패. 실패 1개는 `src/lib/slack/messages/__tests__/sms-sent.test.ts`의 "발신 메시지 Block Kit 포맷 생성"으로, 변경 전에도 실패한다(이 작업과 무관, 손대지 않음). 변경 전은 57개 중 56 통과, 1 실패.
- `src/lib/rental-issue` 시험만: 18개 모두 통과(기존 12 + 새 6).
- 새 문의 시험 5개가 구현 전에 실패하는 것을 먼저 보았다. 이상 접수 글 고정 시험은 변경 전 코드에서 값을 찍은 뒤 변경 후에도 통과했다.
- `npx tsc --noEmit`: 오류 6개. 전부 기존 시험 파일(`cs-notifications.test.ts` 4, `partner-chat.test.ts` 2)이고 변경 전에도 6개다. 바꾼 파일에는 없다.

## 확인하지 못한 것

- `pnpm lint`: 이 폴더의 eslint가 설정을 읽다가 `TypeError: expand is not a function`으로 멈춘다(변경 전 상태에서도 같음). 린트 결과를 얻지 못했다.
- 실제 슬랙에 올려 보지 못했다(바깥 호출 금지). 글 모양은 블록 내용을 시험으로만 확인했다.
- 웹훅 경로(`route.ts`)에는 시험이 없다. 새 갈래는 이상 접수 갈래와 같은 틀이다.

## 배포 순서

권장: ① relay(이 변경) → ② CS DB 마이그레이션 → ③ CS 코드 → ④ 운영자가 "렌탈 문의" 채널 연결.

- relay만 먼저 나가면: 새 사건을 보내는 쪽이 없어 아무 일도 없다.
- relay가 늦으면: 옛 relay는 문의 사건에 자리 없이 `{ ok: true }`만 답하고, CS는 이를 실패로 읽어 약 3시간 동안 8번 다시 보낸 뒤 포기한다. 문의가 "렌탈 이상 접수"로 올라가지는 않는다. 다만 옛 relay는 모르는 사건의 본문을 로그에 남기므로(`CS Tool 웹훅 수신`) 문의 내용·연락처가 로그에 남는다. 그래서 relay를 먼저 배포한다.

새 환경 값: 없음. 스테이징은 기존 `SLACK_CHANNEL_STAGING_TEST`, `CS_STAGING_WEBHOOK_SECRET`을 그대로 쓴다.

## 슬랙 글에 들어가는 개인정보

고객 이름, 연락처(전화번호), 설치 장소(주소), 행사명, 예약번호, 주문번호, 대여 기간, 문의 본문(고객이 쓴 글), 첨부 파일과 파일 이름. 슬랙 알림 미리보기 문구에는 예약번호와 고객 이름이 나온다. 이상 접수 글과 같은 범위다. 새 갈래의 로그에는 출처·글 id·결과만 남긴다.

## 임시로 정한 것

| 항목 | 정한 값 |
|---|---|
| 사건 이름 | `rental.inquiry_reported` |
| 제목 | "렌탈 문의" (알림 문구 "렌탈 문의 · 예약번호 · 고객 이름") |
| 본문 머리말 | "문의 내용" |
| 첨부 안내 | "첨부 N개를 이어서 올립니다." (문의에는 도면도 올 수 있어 "사진" 대신 "첨부") |
| 답변 안내 | "CS 화면(렌탈 관리 › 주문 관리)에서 답변해 주세요. 스레드 댓글은 고객에게 가지 않습니다." |
| CS 링크 | 넣지 않음(이상 접수 글에도 없음) |
| 문의 글 묶기 | 글마다 따로 올림 |
