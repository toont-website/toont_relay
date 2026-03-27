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
 * 모달 내 버튼 클릭의 trigger_id는 push만 가능한 경우가 있음
 */
export async function openOrPushView(
  client: WebClient,
  params: { trigger_id: string; view: any }
) {
  try {
    await client.views.push(params);
  } catch {
    await client.views.open(params);
  }
}
