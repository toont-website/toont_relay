import { WebClient } from "@slack/web-api";
import { getEnv } from "@/lib/config/env";

let _client: WebClient | null = null;

export function getSlackClient(): WebClient {
  if (!_client) {
    const env = getEnv();
    _client = new WebClient(env.SLACK_BOT_TOKEN);
  }
  return _client;
}

/**
 * 모달 안에서 호출 시 views.push, 그 외 views.open
 * fromModal=true: push 시도 → open 폴백
 * fromModal=false: 바로 open (trigger_id 시간 절약)
 */
export async function openOrPushView(
  client: WebClient,
  params: { trigger_id: string; view: any },
  fromModal = false
) {
  if (fromModal) {
    try {
      await client.views.push(params);
      return;
    } catch { /* push 불가 시 open 폴백 */ }
  }
  await client.views.open(params);
}
