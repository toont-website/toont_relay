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
 * E.164 → 사람이 읽기 쉬운 포맷
 * "+821012345678" → "010-1234-5678"
 */
export function formatPhoneNumber(e164: string): string {
  // +820xx → +82xx 정규화 (0 중복 제거)
  const normalized = e164.replace(/^\+820/, "+82");
  const local = "0" + normalized.replace(/^\+82/, "");
  if (local.length === 11) return `${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  return local;
}

/**
 * 어떤 형식이든 → 010-1234-5678 포맷으로
 * E.164, 로컬(01012345678), 앞자리0(001012345678) 전부 처리
 */
export function displayPhoneNumber(input: string): string {
  const normalized = normalizePhoneNumber(input);
  if (normalized) return formatPhoneNumber(normalized);

  // normalizePhoneNumber가 실패하면 그냥 원본 반환
  // 하지만 앞자리 00 제거 시도
  const cleaned = input.replace(/[\s\-()]/g, "");
  if (/^00[1-9]/.test(cleaned)) {
    const withoutPrefix = "0" + cleaned.slice(2);
    const norm = normalizePhoneNumber(withoutPrefix);
    if (norm) return formatPhoneNumber(norm);
  }

  return input;
}
