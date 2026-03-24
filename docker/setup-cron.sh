#!/bin/bash
# toont_relay 크론 설정 스크립트
# 실행: bash docker/setup-cron.sh
#
# 필요한 환경변수: CRON_SECRET, APP_URL (또는 기본값 사용)

set -e

CRON_SECRET="${CRON_SECRET:-$(grep CRON_SECRET .env | cut -d'=' -f2)}"
APP_URL="${APP_URL:-http://localhost:80}"

if [ -z "$CRON_SECRET" ]; then
  echo "❌ CRON_SECRET이 없어요. .env 파일을 확인해주세요."
  exit 1
fi

# 기존 toont_relay 크론 제거
crontab -l 2>/dev/null | grep -v "toont_relay" | crontab - 2>/dev/null || true

# 새 크론 추가
(crontab -l 2>/dev/null || true; cat <<EOF
# === toont_relay 크론 잡 ===
# 기기 상태 모니터링 (5분마다)
*/5 * * * * curl -sf -H "Authorization: Bearer ${CRON_SECRET}" "${APP_URL}/api/cron/health-monitor" > /dev/null 2>&1 # toont_relay
# 마감 D-1 알림 (매일 오전 9시 KST = UTC 00:00)
0 0 * * * curl -sf -H "Authorization: Bearer ${CRON_SECRET}" "${APP_URL}/api/cron/deadline-check" > /dev/null 2>&1 # toont_relay
EOF
) | crontab -

echo "✅ 크론 설정 완료:"
crontab -l | grep "toont_relay"
