/**
 * 한국 전화번호를 E.164 형식으로 정규화
 * "010-1234-5678" | "01012345678" | "+821012345678" → "+821012345678"
 * 유효하지 않으면 null
 */
export function normalizePhoneNumber(input: string): string | null {
  const cleaned = input.replace(/[\s\-()]/g, "");
  if (cleaned === "") return null;

  // 이미 E.164 (+820 중복 제거)
  if (/^\+820\d{9,10}$/.test(cleaned)) return `+82${cleaned.slice(4)}`;
  if (/^\+82\d{9,10}$/.test(cleaned)) return cleaned;

  // 한국 로컬 번호
  if (/^01[0-9]\d{7,8}$/.test(cleaned)) return `+82${cleaned.slice(1)}`;

  return null;
}

/**
 * 어떤 전화번호 포맷이든 → 010-1234-5678 형식으로
 * "+821012345678" | "01012345678" | "010-1234-5678" 전부 처리
 */
export function formatPhoneNumber(input: string): string {
  const e164 = normalizePhoneNumber(input);
  if (!e164) return input;

  const local = "0" + e164.replace(/^\+82/, "");
  if (local.length === 11) return `${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  return local;
}

/**
 * @deprecated formatPhoneNumber이 모든 포맷을 처리하므로 그걸 쓰세요
 */
export const displayPhoneNumber = formatPhoneNumber;
