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
