# TOONT Relay (경유서버)

슬랙 채널에서 SMS 수신/발신을 관리하는 경유서버.

## 구성

| 서비스 | 역할 |
|--------|------|
| app (Next.js) | 슬랙봇 + SMS 연동 + 웹훅 처리 |
| sms-backend | SMS Gateway 프라이빗 서버 (API) |
| sms-worker | SMS Gateway 백그라운드 워커 |
| mysql | DB (경유서버 + SMS Gateway 공유) |
| nginx | 리버스 프록시 + SSL |

## 배포 환경

- GCE VM (e2-small) + Docker Compose
- 도메인: `relay.toont.co.kr`
- SSL: Let's Encrypt (certbot)

## 환경변수 (.env)

```env
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_CHANNEL_CS_SMS=C0ALP2LKTR8

# SMS Gateway API (폰 앱 연결 후 자동 생성되는 크레덴셜)
SMS_GATEWAY_URL=http://sms-backend:3080
SMS_GATEWAY_USERNAME=...
SMS_GATEWAY_PASSWORD=...
SMS_GATEWAY_WEBHOOK_SECRET=...

# SMS Gateway Private Token (폰 앱 연결용)
ASG_GATEWAY_PRIVATE_TOKEN=...

# Database
DATABASE_URL=mysql://toont:Toont2026!@mysql:3306/toont_relay?charset=utf8mb4
MYSQL_ROOT_PASSWORD=...

# App
NODE_ENV=production
APP_URL=https://relay.toont.co.kr
```

## SMS Gateway (CS폰) 연결

### 최초 설정

1. CS폰에서 플레이스토어 → **"SMS Gateway"** (capcom6) 설치
2. 앱 → Settings:
   - Server URL: `https://relay.toont.co.kr/sms-gateway`
   - Private Token: `.env`의 `ASG_GATEWAY_PRIVATE_TOKEN` 값
3. Start 버튼 → 서버 연결
4. 앱 화면에 표시되는 **Username / Password** 확인
5. `.env`에 입력:
   ```
   SMS_GATEWAY_USERNAME=표시된_유저네임
   SMS_GATEWAY_PASSWORD=표시된_패스워드
   ```
6. `docker compose restart app`

### 크레덴셜 유지 조건

| 상황 | 크레덴셜 |
|------|----------|
| 폰 재시작 | 유지 (자동 재연결) |
| 앱 강제 종료 후 재시작 | 유지 |
| 서버(VM) 재시작 | 유지 |
| 앱 삭제 후 재설치 | **새로 발급** → .env 업데이트 필요 |
| DB 볼륨 초기화 (`docker volume rm`) | **새로 발급** → .env 업데이트 필요 |

### 연결 상태 확인

```bash
# 헬스체크 (mysql + smsGateway 둘 다 ok이면 정상)
curl https://relay.toont.co.kr/api/health

# SMS Gateway 로그
docker compose logs sms-backend --tail 10
```

## 슬랙 커맨드

| 커맨드 | 동작 |
|--------|------|
| `/sms` | SMS 발송 모달 오픈 |
| `/sms [번호] [메시지]` | 번호로 직접 발송 |
| `/sms [이름] [메시지]` | 연락처 검색 → 발송 |
| `/contact` | 연락처 목록 |
| `/contact [이름] [번호] [메모]` | 연락처 추가 |
| `/contact 삭제 [이름]` | 연락처 삭제 |

## 슬랙 앱 설정 (api.slack.com)

| 설정 | URL |
|------|-----|
| Slash Commands (`/sms`, `/contact`) | `https://relay.toont.co.kr/api/slack/command` |
| Interactivity → Request URL | `https://relay.toont.co.kr/api/slack/action` |
| Interactivity → Options Load URL | `https://relay.toont.co.kr/api/slack/options` |

## 운영

### 서버 시작/중지

```bash
cd ~/toont_replay
docker compose up -d      # 전체 시작
docker compose down        # 전체 중지
docker compose restart app # 앱만 재시작
```

### 코드 업데이트 배포

```bash
cd ~/toont_replay
git pull
docker compose up -d --build
```

### DB 직접 접근

```bash
docker compose exec mysql mysql -u toont -p'Toont2026!' --default-character-set=utf8mb4 toont_relay
```

### SSL 인증서 갱신

certbot이 자동 갱신하지만, 수동으로 하려면:

```bash
docker compose stop nginx
sudo certbot renew
docker compose start nginx
```

### 로그 확인

```bash
docker compose logs app --tail 30          # 앱 로그
docker compose logs sms-backend --tail 30  # SMS Gateway 로그
docker compose logs nginx --tail 30        # nginx 로그
```
