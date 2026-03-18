import { describe, expect, it } from "vitest";
import { verifySlackSignature } from "../verify";
import { createHmac } from "node:crypto";

const SIGNING_SECRET = "test-signing-secret";

function makeValidHeaders(body: string, timestamp?: number) {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const sigBasestring = `v0:${ts}:${body}`;
  const signature = "v0=" + createHmac("sha256", SIGNING_SECRET).update(sigBasestring).digest("hex");
  return { timestamp: String(ts), signature };
}

describe("verifySlackSignature", () => {
  it("유효한 서명 → true", () => {
    const body = "token=xxx&command=%2F문자";
    const { timestamp, signature } = makeValidHeaders(body);
    expect(verifySlackSignature(SIGNING_SECRET, signature, timestamp, body)).toBe(true);
  });

  it("잘못된 서명 → false", () => {
    expect(verifySlackSignature(SIGNING_SECRET, "v0=invalid", "12345", "body")).toBe(false);
  });

  it("5분 이상 된 타임스탬프 → false", () => {
    const body = "test";
    const oldTs = Math.floor(Date.now() / 1000) - 600;
    const { signature } = makeValidHeaders(body, oldTs);
    expect(verifySlackSignature(SIGNING_SECRET, signature, String(oldTs), body)).toBe(false);
  });
});
