import { logger } from "@/lib/logger";

/**
 * 슬랙 response_url로 deferred 응답 전송
 * slash command의 원본 메시지를 교체함
 */
export async function postToResponseUrl(
  responseUrl: string,
  body: Record<string, unknown>
): Promise<void> {
  try {
    const res = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replace_original: true, ...body }),
    });

    if (!res.ok) {
      logger.error(
        { status: res.status, url: responseUrl },
        "response_url POST 실패"
      );
    }
  } catch (error) {
    logger.error({ error, url: responseUrl }, "response_url POST 에러");
  }
}
