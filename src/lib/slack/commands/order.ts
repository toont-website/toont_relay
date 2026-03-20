import { getCsToolClient } from "@/lib/cs-tool/client";
import { formatPhoneNumber, normalizePhoneNumber } from "@/lib/utils/phone";
import { logger } from "@/lib/logger";

/**
 * /주문 [검색어|ID]
 * - /주문 → 최근 주문 목록
 * - /주문 홍길동 → 고객명 검색
 * - /주문 접수 → 상태 필터
 */
export async function handleOrderCommand(text: string) {
  const trimmed = text.trim();
  const client = getCsToolClient();

  try {
    const filters: Record<string, string> = { limit: "10" };
    if (trimmed) {
      // 상태 키워드 체크
      const statusMap: Record<string, string> = {
        접수: "received",
        제작: "production",
        배송중: "shipping",
        완료: "completed",
        취소: "cancelled",
      };
      if (statusMap[trimmed]) {
        filters.status = statusMap[trimmed];
      } else {
        filters.customer = trimmed;
      }
    }

    const result = await client.getOrders(filters);
    const orders = result.data ?? [];

    if (orders.length === 0) {
      return { text: trimmed ? `"${trimmed}" 검색 결과가 없어요.` : "주문이 없어요." };
    }

    const list = orders
      .map((order) => {
        const phone = order.phone ? ` (${formatPhoneNumber(order.phone)})` : "";
        const stage = order.currentStageName ? ` · ${order.currentStageName}` : "";
        const date = new Date(order.createdAt).toLocaleDateString("ko-KR");
        return `• *${order.customerName}*${phone} — ${order.itemDescription} x${order.quantity}${stage} _(${date})_`;
      })
      .join("\n");

    const total = result.meta?.total ?? orders.length;
    const title = trimmed ? `"${trimmed}" 검색 결과` : "최근 주문";

    return { text: `*📋 ${title}* (${total}건)\n\n${list}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ error: msg }, "주문 조회 실패");
    return { text: `주문 조회에 실패했어요.\n에러: ${msg}` };
  }
}

/**
 * /주문추가 [고객명] [상품] [수량] [전화번호]
 * 예: /주문추가 홍길동 "직선형 120cm - 포슬린" 2 010-1234-5678
 */
export async function handleOrderCreateCommand(text: string, userId: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      text: "사용법: `/주문추가 [고객명] [상품] [수량] [전화번호]`\n예: `/주문추가 홍길동 직선형120cm-포슬린 2 010-1234-5678`",
    };
  }

  // 따옴표로 묶인 상품명 처리
  const quoteMatch = trimmed.match(/^(\S+)\s+"([^"]+)"\s+(\d+)\s+(\S+)/);
  const spaceMatch = trimmed.match(/^(\S+)\s+(\S+)\s+(\d+)\s+(\S+)/);
  const match = quoteMatch ?? spaceMatch;

  if (!match) {
    return {
      text: "형식이 올바르지 않아요.\n사용법: `/주문추가 [고객명] [상품] [수량] [전화번호]`",
    };
  }

  const customerName = match[1];
  const itemDescription = match[2];
  const quantity = parseInt(match[3], 10);
  const phone = normalizePhoneNumber(match[4]) ?? match[4];

  if (isNaN(quantity) || quantity <= 0) {
    return { text: "수량은 1 이상의 숫자로 입력해주세요." };
  }

  try {
    const client = getCsToolClient();
    await client.createOrder({
      customerName,
      itemDescription,
      quantity,
      phone,
      channel: "slack",
    });

    return {
      text: `✅ 주문이 등록됐어요!\n*${customerName}* — ${itemDescription} x${quantity}\n📞 ${formatPhoneNumber(phone)}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    return { text: `주문 등록에 실패했어요.\n에러: ${msg}` };
  }
}
