import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebClient } from "@slack/web-api";
import { z } from "zod";

// CS 렌탈 이상 접수(rental.issue_reported)를 슬랙에 올리고, [답변하기]로 받은 답을 CS로 돌려보낸다.
// CS는 다른 알림처럼 서명된 웹훅으로 알린다. 운영 CS는 CS_TOOL_WEBHOOK_SECRET, 스테이징 CS는 CS_STAGING_WEBHOOK_SECRET으로 서명한다.
// 스테이징에서 온 것은 채널과 상관없이 SLACK_CHANNEL_STAGING_TEST에만 올리고, 답도 스테이징 CS로만 보낸다.

export type RentalIssueOrigin = "production" | "staging";
export const RENTAL_ISSUE_EVENT = "rental.issue_reported";
export const RENTAL_ISSUE_REPLY_ACTION = "rental_issue_reply";
export const RENTAL_ISSUE_REPLY_CALLBACK = "rental_issue_reply";
export const RENTAL_ISSUE_REPLY_BLOCK = "reply";
export const RENTAL_ISSUE_REPLY_INPUT = "body";
export const RENTAL_ISSUE_REPLY_MAX = 2000;

/** 환경값(getEnv() 그대로 받는다). 숫자 칸도 있으니 문자열만 꺼내 쓴다. */
type Env = Record<string, unknown>;
const str = (env: Env, key: string): string | undefined => (typeof env[key] === "string" && env[key] ? (env[key] as string) : undefined);

function signatureMatches(signature: string, timestamp: string, body: string, secret: string | undefined): boolean {
  if (!secret || !signature || !timestamp) return false;
  const elapsed = Date.now() - new Date(timestamp).getTime();
  if (Number.isNaN(elapsed) || Math.abs(elapsed) > 5 * 60 * 1000) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const a = Buffer.from(signature), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 어느 CS가 보냈는지: 운영 비밀값이 맞으면 운영, 스테이징 비밀값이 맞으면 스테이징, 아니면 null. */
export function webhookOrigin(signature: string, timestamp: string, body: string, env: Env): RentalIssueOrigin | null {
  if (signatureMatches(signature, timestamp, body, str(env, "CS_TOOL_WEBHOOK_SECRET"))) return "production";
  if (signatureMatches(signature, timestamp, body, str(env, "CS_STAGING_WEBHOOK_SECRET"))) return "staging";
  return null;
}

export const rentalIssuePayload = z.object({
  channelId: z.string().nullable(),
  reservation: z.object({
    id: z.string(), no: z.string(), sourceOrderId: z.string(), customerName: z.string(), customerPhone: z.string(),
    eventName: z.string(), address: z.string(), startDate: z.string(), endDate: z.string(),
  }),
  message: z.object({ id: z.string(), issueId: z.string(), body: z.string(), createdAt: z.string(), followUp: z.boolean() }),
  thread: z.object({ channel: z.string(), ts: z.string() }).nullable(),
  posted: z.object({ channel: z.string(), ts: z.string() }).nullable(),
  filesDone: z.number().int().min(0),
  files: z.array(z.object({ id: z.string(), name: z.string(), size: z.number(), url: z.string().url() })).max(20),
});
export type RentalIssuePayload = z.output<typeof rentalIssuePayload>;

/** [답변하기] 버튼과 입력 창이 들고 다니는 값. e: 보낸 CS(p 운영, s 스테이징), c·t: 답을 알릴 스레드. */
export const replyMeta = z.object({
  o: z.string().min(1).max(100), i: z.string().min(1).max(100), r: z.string().min(1).max(100),
  e: z.enum(["p", "s"]), c: z.string().max(40).optional(), t: z.string().max(40).optional(),
});
export type ReplyMeta = z.output<typeof replyMeta>;
export function parseReplyMeta(value: unknown): ReplyMeta | null {
  if (typeof value !== "string") return null;
  try { const out = replyMeta.safeParse(JSON.parse(value)); return out.success ? out.data : null; } catch { return null; }
}

/** 고객 글이 슬랙 링크·멘션이 되지 않게 한다. */
export const slackEscape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // 고객 글의 @here·@channel·@everyone이 채널 전체 호출이 되지 않게 보이지 않는 글자를 끼운다.
    .replace(/@(here|channel|everyone)\b/gi, "@\u200b$1");
const seoul = (iso: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

export function buildRentalIssueMessage(data: RentalIssuePayload, origin: RentalIssueOrigin): { text: string; blocks: unknown[] } {
  const body = slackEscape(data.message.body);
  const files = data.files.length > 0 ? `\n_사진 ${data.files.length}장을 이어서 올립니다._` : "";
  const tag = origin === "staging" ? "[스테이징 시험] " : "";
  if (data.message.followUp) {
    const text = `${tag}고객이 이상 접수에 덧붙였습니다 (${seoul(data.message.createdAt)})`;
    return { text, blocks: [{ type: "section", text: { type: "mrkdwn", text: `*${text}*\n${body}${files}` } }] };
  }
  const r = data.reservation;
  const meta: ReplyMeta = { o: r.sourceOrderId, i: data.message.issueId, r: r.id, e: origin === "staging" ? "s" : "p" };
  const text = `${tag}렌탈 이상 접수 · ${r.no} · ${r.customerName}`;
  return {
    text,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `${tag}렌탈 이상 접수`, emoji: false } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*예약번호*\n${slackEscape(r.no)}` },
        { type: "mrkdwn", text: `*주문번호*\n${slackEscape(r.sourceOrderId)}` },
        { type: "mrkdwn", text: `*고객*\n${slackEscape(r.customerName)} ${slackEscape(r.customerPhone)}` },
        { type: "mrkdwn", text: `*대여 기간*\n${r.startDate} ~ ${r.endDate}` },
        { type: "mrkdwn", text: `*행사*\n${slackEscape(r.eventName) || "-"}` },
        { type: "mrkdwn", text: `*설치 장소*\n${slackEscape(r.address) || "-"}` },
      ] },
      { type: "section", text: { type: "mrkdwn", text: `*접수 내용* (${seoul(data.message.createdAt)})\n${body}${files}` } },
      { type: "actions", elements: [{ type: "button", action_id: RENTAL_ISSUE_REPLY_ACTION, style: "primary", text: { type: "plain_text", text: "답변하기" }, value: JSON.stringify(meta) }] },
      { type: "context", elements: [{ type: "mrkdwn", text: "[답변하기]로 보낸 글만 고객에게 갑니다. 스레드 댓글은 고객에게 가지 않습니다." }] },
    ],
  };
}

export function buildReplyModal(meta: ReplyMeta): unknown {
  return {
    type: "modal",
    callback_id: RENTAL_ISSUE_REPLY_CALLBACK,
    private_metadata: JSON.stringify(meta),
    title: { type: "plain_text", text: "이상 접수 답변" },
    submit: { type: "plain_text", text: "고객에게 보내기" },
    close: { type: "plain_text", text: "닫기" },
    blocks: [
      { type: "context", elements: [{ type: "mrkdwn", text: `주문번호 ${slackEscape(meta.o)} · 이 글은 고객 화면과 알림(메일·알림톡 설정대로)으로 그대로 갑니다.${meta.e === "s" ? " (스테이징 시험)" : ""}` }] },
      { type: "input", block_id: RENTAL_ISSUE_REPLY_BLOCK, label: { type: "plain_text", text: "고객에게 보낼 답변" },
        element: { type: "plain_text_input", action_id: RENTAL_ISSUE_REPLY_INPUT, multiline: true, max_length: RENTAL_ISSUE_REPLY_MAX } },
    ],
  };
}

// 같은 글을 CS가 다시 보내면(응답을 잃은 재시도) 이미 올린 자리를 돌려준다. 한 대(VM) 메모리라 재시작하면 잊는다(CS도 올린 자리를 기억한다).
const posted = new Map<string, { channel: string; ts: string; filesDone: number; at: number }>();
const DAY = 86_400_000;
function remember(key: string, value: { channel: string; ts: string; filesDone: number }) {
  posted.set(key, { ...value, at: Date.now() });
  if (posted.size > 2000) for (const [k, v] of posted) if (Date.now() - v.at > DAY) posted.delete(k);
}
export function forgetPostedForTest() { posted.clear(); }

export type RentalIssueHandled =
  | { status: 200; body: { ok: true; channel: string; ts: string; filesDone: number } | { ok: true; skipped: true; reason: string } }
  | { status: 502; body: { ok: false; error: string; posted?: { channel: string; ts: string; filesDone: number } } };

/** 글과 사진을 올린다. 글을 올린 뒤 사진에서 멈추면 올린 자리를 함께 돌려줘 CS가 같은 글을 다시 올리지 않게 한다. */
export async function handleRentalIssueReported(
  data: RentalIssuePayload,
  origin: RentalIssueOrigin,
  deps: { slack: Pick<WebClient, "chat" | "files">; env: Env; fetch?: typeof fetch }
): Promise<RentalIssueHandled> {
  const channel = origin === "staging" ? str(deps.env, "SLACK_CHANNEL_STAGING_TEST") : data.thread?.channel ?? data.posted?.channel ?? data.channelId;
  if (!channel) return { status: 200, body: { ok: true, skipped: true, reason: origin === "staging" ? "NO_STAGING_TEST_CHANNEL" : "NO_CHANNEL" } };
  const key = `${origin}:${data.message.id}`;
  const known = posted.get(key);
  let ts = data.posted?.ts ?? known?.ts ?? null;
  let filesDone = Math.max(data.filesDone, known?.filesDone ?? 0);
  const threadTs = data.message.followUp ? data.thread?.ts : undefined;
  if (data.message.followUp && !threadTs) return { status: 502, body: { ok: false, error: "THREAD_MISSING" } };
  if (!ts) {
    const built = buildRentalIssueMessage(data, origin);
    try {
      const sent = await deps.slack.chat.postMessage({ channel, text: built.text, blocks: built.blocks as never, ...(threadTs ? { thread_ts: threadTs } : {}) });
      if (!sent.ok || !sent.ts) return { status: 502, body: { ok: false, error: `SLACK_${sent.error ?? "POST_FAILED"}` } };
      ts = sent.ts;
    } catch (error) {
      return { status: 502, body: { ok: false, error: `SLACK_${(error as { data?: { error?: string } }).data?.error ?? "POST_FAILED"}` } };
    }
    remember(key, { channel, ts, filesDone });
  }
  for (const file of data.files.slice(filesDone)) {
    try {
      const got = await (deps.fetch ?? fetch)(file.url, { signal: AbortSignal.timeout(20_000) });
      if (!got.ok) throw new Error(`FILE_${got.status}`);
      const bytes = Buffer.from(await got.arrayBuffer());
      await deps.slack.files.uploadV2({ channel_id: channel, thread_ts: threadTs ?? ts, file: bytes, filename: file.name });
    } catch (error) {
      return { status: 502, body: { ok: false, error: error instanceof Error ? error.message.slice(0, 80) : "FILE_FAILED", posted: { channel, ts, filesDone } } };
    }
    filesDone += 1;
    remember(key, { channel, ts, filesDone });
  }
  return { status: 200, body: { ok: true, channel, ts, filesDone } };
}

/** 입력 창에서 보낸 답을 그 접수를 보낸 CS로 보낸다(운영·스테이징을 섞지 않는다). */
export async function sendReplyToCs(
  meta: ReplyMeta,
  body: string,
  replyKey: string,
  deps: { env: Env; fetch?: typeof fetch }
): Promise<{ ok: true } | { ok: false; message: string }> {
  const base = meta.e === "s" ? str(deps.env, "CS_STAGING_API_URL") : str(deps.env, "CS_TOOL_API_URL");
  const key = meta.e === "s" ? str(deps.env, "CS_STAGING_API_KEY") : str(deps.env, "CS_TOOL_API_KEY");
  if (!base || !key) return { ok: false, message: "CS 연결 설정이 없어 보내지 못했습니다." };
  try {
    const response = await (deps.fetch ?? fetch)(`${base.replace(/\/+$/, "")}/rental/issue-replies`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: meta.o, issueId: meta.i, body, replyKey }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return { ok: true };
    const json = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, message: json?.error?.message ?? "보내지 못했습니다. 잠시 후 다시 보내 주세요." };
  } catch {
    return { ok: false, message: "CS에 닿지 못했습니다. 잠시 후 다시 보내 주세요." };
  }
}

/**
 * 입력 창 제출: 슬랙은 3초 안에 답을 기다리므로 창은 바로 닫고, CS로 보내는 일은 뒤에서 한다.
 * 결과는 접수 글의 스레드에 남긴다(보냈으면 누가 무엇을 보냈는지, 못 보냈으면 이유와 다시 누르라는 안내).
 */
export async function deliverReplyAndNotify(
  input: { meta: ReplyMeta; body: string; viewId: string; userId?: string },
  deps: { slack: Pick<WebClient, "chat">; env: Env; fetch?: typeof fetch }
): Promise<boolean> {
  const sent = await sendReplyToCs(input.meta, input.body, `slack:${input.viewId}`, deps);
  if (input.meta.c && input.meta.t) {
    const who = input.userId ? `<@${input.userId}>` : "담당자";
    const text = sent.ok
      ? `*${who}님이 고객에게 답했습니다*\n${slackEscape(input.body)}`
      : `*${who}님의 답변을 보내지 못했습니다*: ${slackEscape(sent.message)}\n[답변하기]를 다시 눌러 주세요.`;
    await deps.slack.chat.postMessage({ channel: input.meta.c, thread_ts: input.meta.t, text: sent.ok ? "고객에게 답했습니다" : "답변을 보내지 못했습니다", blocks: [{ type: "section", text: { type: "mrkdwn", text } }] as never }).catch(() => undefined);
  }
  return sent.ok;
}
