import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RENTAL_ISSUE_REPLY_ACTION,
  buildRentalIssueMessage,
  deliverReplyAndNotify,
  forgetPostedForTest,
  handleRentalIssueReplied,
  handleRentalIssueReported,
  rentalIssueRepliedPayload,
  parseReplyMeta,
  sendReplyToCs,
  webhookOrigin,
  type RentalIssuePayload,
} from "../relay";

const env = {
  CS_TOOL_WEBHOOK_SECRET: "prod-secret",
  CS_STAGING_WEBHOOK_SECRET: "stage-secret",
  CS_TOOL_API_URL: "https://cs.prod/api/v1",
  CS_TOOL_API_KEY: "prod-key",
  CS_STAGING_API_URL: "https://cs.stage/api/v1",
  CS_STAGING_API_KEY: "stage-key",
  SLACK_CHANNEL_STAGING_TEST: "CTEST",
  HEALTH_CHECK_DEVICE_THRESHOLD_MINUTES: 30,
};
const sign = (body: string, ts: string, secret: string) => "sha256=" + createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
const payload = (over: Partial<RentalIssuePayload> = {}): RentalIssuePayload => ({
  channelId: "CPROD",
  reservation: { id: "res", no: "R-1", sourceOrderId: "ORD1", customerName: "김담당", customerPhone: "010-1234-5678", eventName: "가을 전시", address: "서울", startDate: "2026-11-30", endDate: "2026-12-02" },
  message: { id: "m1", issueId: "m1", body: "조명 <하나>가 & 안 켜져요", createdAt: "2026-12-01T01:00:00.000Z", followUp: false },
  thread: null,
  posted: null,
  filesDone: 0,
  files: [{ id: "f1", name: "조명.jpg", size: 3, url: "https://cs.prod/api/relay/rental-issue-files?o=ORD1&f=f1" }],
  ...over,
});
function slack({ failUpload = false } = {}) {
  const posts: Record<string, unknown>[] = [], uploads: Record<string, unknown>[] = [];
  return {
    posts, uploads,
    client: {
      chat: { postMessage: vi.fn(async (args: Record<string, unknown>) => { posts.push(args); return { ok: true, ts: "111.222" }; }) },
      files: { uploadV2: vi.fn(async (args: Record<string, unknown>) => { if (failUpload) throw new Error("upload failed"); uploads.push(args); return { ok: true }; }) },
    } as never,
  };
}
const fileFetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));

beforeEach(() => { forgetPostedForTest(); fileFetch.mockClear(); });

describe("who sent it", () => {
  it("tells production from staging by the secret, and refuses anything else", () => {
    const ts = new Date().toISOString(), body = "{}";
    expect(webhookOrigin(sign(body, ts, "prod-secret"), ts, body, env)).toBe("production");
    expect(webhookOrigin(sign(body, ts, "stage-secret"), ts, body, env)).toBe("staging");
    expect(webhookOrigin(sign(body, ts, "other"), ts, body, env)).toBeNull();
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(webhookOrigin(sign(body, old, "prod-secret"), old, body, env)).toBeNull();
  });
});

describe("posting a report", () => {
  it("posts the booking, the customer words as plain text, a reply button, then the photos in the thread", async () => {
    const s = slack();
    const out = await handleRentalIssueReported(payload(), "production", { slack: s.client, env, fetch: fileFetch as never });
    expect(out).toEqual({ status: 200, body: { ok: true, channel: "CPROD", ts: "111.222", filesDone: 1 } });
    const json = JSON.stringify(s.posts[0].blocks);
    expect(json).toContain("조명 &lt;하나&gt;가 &amp; 안 켜져요");
    expect(buildRentalIssueMessage(payload({ message: { id: "m9", issueId: "m9", body: "@here 와 @channel 봐 주세요", createdAt: "2026-12-01T01:00:00.000Z", followUp: false } }), "production").blocks.map((b) => JSON.stringify(b)).join()).not.toMatch(/@(here|channel)\b/);
    expect(json).toContain(RENTAL_ISSUE_REPLY_ACTION);
    expect(s.uploads[0]).toMatchObject({ channel_id: "CPROD", thread_ts: "111.222", filename: "조명.jpg" });
  });

  it("staging always goes to the test channel and is marked, whatever channel CS chose", async () => {
    const s = slack();
    await handleRentalIssueReported(payload({ channelId: "CPROD" }), "staging", { slack: s.client, env, fetch: fileFetch as never });
    expect(s.posts[0].channel).toBe("CTEST");
    expect(String(s.posts[0].text)).toContain("[스테이징 시험]");
    const button = (s.posts[0].blocks as { type: string; elements?: { value: string }[] }[]).find((b) => b.type === "actions")!.elements![0];
    expect(parseReplyMeta(button.value)).toEqual({ o: "ORD1", i: "m1", r: "res", e: "s" });
  });

  it("without a channel it skips (staging without a test channel too)", async () => {
    const s = slack();
    expect((await handleRentalIssueReported(payload({ channelId: null }), "production", { slack: s.client, env })).body).toEqual({ ok: true, skipped: true, reason: "NO_CHANNEL" });
    expect((await handleRentalIssueReported(payload(), "staging", { slack: s.client, env: { ...env, SLACK_CHANNEL_STAGING_TEST: undefined } })).body).toMatchObject({ skipped: true });
    expect(s.posts).toHaveLength(0);
  });

  it("a photo that fails returns where the post is, and the retry does not post again", async () => {
    const bad = slack({ failUpload: true });
    const first = await handleRentalIssueReported(payload(), "production", { slack: bad.client, env, fetch: fileFetch as never });
    expect(first).toEqual({ status: 502, body: { ok: false, error: "upload failed", posted: { channel: "CPROD", ts: "111.222", filesDone: 0 } } });
    const good = slack();
    await handleRentalIssueReported(payload({ posted: { channel: "CPROD", ts: "111.222" } }), "production", { slack: good.client, env, fetch: fileFetch as never });
    expect(good.posts).toHaveLength(0);
    expect(good.uploads).toHaveLength(1);
  });

  it("the same report sent again (answer lost) is not posted twice", async () => {
    const s = slack();
    await handleRentalIssueReported(payload(), "production", { slack: s.client, env, fetch: fileFetch as never });
    await handleRentalIssueReported(payload(), "production", { slack: s.client, env, fetch: fileFetch as never });
    expect(s.posts).toHaveLength(1);
    expect(s.uploads).toHaveLength(1);
  });

  it("an addition goes into the first report's thread without a second button", async () => {
    const s = slack();
    const add = payload({ message: { id: "m2", issueId: "m1", body: "사진 더", createdAt: "2026-12-01T02:00:00.000Z", followUp: true }, thread: { channel: "CPROD", ts: "1.1" }, files: [] });
    await handleRentalIssueReported(add, "production", { slack: s.client, env });
    expect(s.posts[0]).toMatchObject({ channel: "CPROD", thread_ts: "1.1" });
    expect(JSON.stringify(s.posts[0].blocks)).not.toContain(RENTAL_ISSUE_REPLY_ACTION);
    expect(buildRentalIssueMessage(add, "production").text).toContain("덧붙였습니다");
  });
});

describe("answering from Slack", () => {
  it("sends the answer to the CS that sent the report, with the window id as the key", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ success: true }));
    await sendReplyToCs({ o: "ORD1", i: "m1", r: "res", e: "s" }, "교체해 드릴게요", "slack:V1", { env, fetch: fetch as never });
    expect(fetch.mock.calls[0][0]).toBe("https://cs.stage/api/v1/rental/issue-replies");
    expect((fetch.mock.calls[0][1].headers as Record<string, string>).Authorization).toBe("Bearer stage-key");
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ orderId: "ORD1", issueId: "m1", body: "교체해 드릴게요", replyKey: "slack:V1" });
    await sendReplyToCs({ o: "ORD1", i: "m1", r: "res", e: "p" }, "x", "slack:V2", { env, fetch: fetch as never });
    expect(fetch.mock.calls[1][0]).toBe("https://cs.prod/api/v1/rental/issue-replies");
  });

  it("tells the thread who answered, or why it did not go", async () => {
    const s = slack();
    await deliverReplyAndNotify({ meta: { o: "ORD1", i: "m1", r: "res", e: "p", c: "CPROD", t: "1.1" }, body: "교체해 드릴게요", viewId: "V1", userId: "U1" },
      { slack: s.client, env, fetch: (async () => Response.json({ success: true })) as never });
    expect(String((s.posts[0].blocks as { text: { text: string } }[])[0].text.text)).toContain("<@U1>님이 고객에게 답했습니다");
    await deliverReplyAndNotify({ meta: { o: "ORD1", i: "m1", r: "res", e: "p", c: "CPROD", t: "1.1" }, body: "x", viewId: "V2" },
      { slack: s.client, env, fetch: (async () => Response.json({ success: false, error: { message: "쇼핑몰에서 이 접수를 찾지 못했습니다." } }, { status: 404 })) as never });
    expect(String((s.posts[1].blocks as { text: { text: string } }[])[0].text.text)).toContain("쇼핑몰에서 이 접수를 찾지 못했습니다.");
  });
});

describe("answering from the CS screen", () => {
  const replied = { thread: { channel: "CPROD", ts: "1.1" }, orderId: "ORD1", staffName: "김담당", body: "교체 <기사>님 보낼게요 @here", repliedAt: "2026-12-01T02:00:00.000Z" };
  it("notes in the report's thread who answered and what, as plain text", async () => {
    const s = slack();
    const out = await handleRentalIssueReplied(rentalIssueRepliedPayload.parse(replied), "production", { slack: s.client, env });
    expect(out).toEqual({ status: 200, body: { ok: true, ts: "111.222" } });
    expect(s.posts[0]).toMatchObject({ channel: "CPROD", thread_ts: "1.1" });
    const text = String((s.posts[0].blocks as { text: { text: string } }[])[0].text.text);
    expect(text).toContain("김담당님이 CS 화면에서 고객에게 답했습니다");
    expect(text).toContain("&lt;기사&gt;");
    expect(text).toContain("@​here");
  });
  it("a staging answer goes only to the test channel, whatever channel it names", async () => {
    const s = slack();
    await handleRentalIssueReplied(rentalIssueRepliedPayload.parse(replied), "staging", { slack: s.client, env });
    expect(s.posts[0]).toMatchObject({ channel: "CTEST", thread_ts: "1.1" });
    expect(String(s.posts[0].text)).toContain("[스테이징 시험]");
  });
});

import { verifySlackSignature } from "@/lib/slack/verify";
describe("moving to a new Slack app", () => {
  it("a request signed with either the new or the old app secret verifies with its own secret only", () => {
    const ts = String(Math.floor(Date.now() / 1000)), body = "payload=x";
    const sig = (secret: string) => "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
    expect(verifySlackSignature("new", sig("new"), ts, body)).toBe(true);
    expect(verifySlackSignature("new", sig("old"), ts, body)).toBe(false);
    expect(verifySlackSignature("old", sig("old"), ts, body)).toBe(true);
  });
});
