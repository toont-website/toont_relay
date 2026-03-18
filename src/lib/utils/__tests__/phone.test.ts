import { describe, expect, it } from "vitest";
import { normalizePhoneNumber, formatPhoneNumber } from "../phone";

describe("normalizePhoneNumber", () => {
  it("010-1234-5678 → +821012345678", () => {
    expect(normalizePhoneNumber("010-1234-5678")).toBe("+821012345678");
  });
  it("01012345678 → +821012345678", () => {
    expect(normalizePhoneNumber("01012345678")).toBe("+821012345678");
  });
  it("+821012345678 → +821012345678 (이미 E.164)", () => {
    expect(normalizePhoneNumber("+821012345678")).toBe("+821012345678");
  });
  it("010 1234 5678 (공백) → +821012345678", () => {
    expect(normalizePhoneNumber("010 1234 5678")).toBe("+821012345678");
  });
  it("빈 문자열 → null", () => {
    expect(normalizePhoneNumber("")).toBeNull();
  });
  it("유효하지 않은 번호 → null", () => {
    expect(normalizePhoneNumber("12345")).toBeNull();
  });
  it("+8201095337464 → +821095337464 (0 중복 제거)", () => {
    expect(normalizePhoneNumber("+8201095337464")).toBe("+821095337464");
  });
});

describe("formatPhoneNumber", () => {
  it("+821012345678 → 010-1234-5678", () => {
    expect(formatPhoneNumber("+821012345678")).toBe("010-1234-5678");
  });
  it("+821098765432 → 010-9876-5432", () => {
    expect(formatPhoneNumber("+821098765432")).toBe("010-9876-5432");
  });
  it("+8201095337464 → 010-9533-7464 (0 중복 처리)", () => {
    expect(formatPhoneNumber("+8201095337464")).toBe("010-9533-7464");
  });
});
