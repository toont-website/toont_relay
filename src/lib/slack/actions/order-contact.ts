import { getCsToolClient } from "@/lib/cs-tool/client";
import { getSlackClient } from "@/lib/slack/client";
import { logger } from "@/lib/logger";

export async function openOrderContactModal(triggerId: string, orderId: string) {
  const client = getCsToolClient();
  const slackClient = getSlackClient();

  const order = await client.getOrder(orderId);
  if (!order.data) return;

  const unassigned = order.data.requiredContactTypes.filter(
    (rt) => !order.data!.contacts.find((c) => c.type === rt.slug)
  );

  if (unassigned.length === 0) return;

  const blocks = unassigned.map((rt) => ({
    type: "input",
    block_id: `contact_${rt.slug}`,
    label: { type: "plain_text", text: `${rt.name} 연락처` },
    element: {
      type: "external_select",
      action_id: `contact_select_${rt.slug}`,
      placeholder: { type: "plain_text", text: `${rt.name} 검색...` },
      min_query_length: 1,
    },
  }));

  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "order_contact_modal",
      private_metadata: JSON.stringify({ orderId }),
      title: { type: "plain_text", text: "연락처 배정" },
      submit: { type: "plain_text", text: "배정" },
      close: { type: "plain_text", text: "취소" },
      blocks,
    },
  });
}

export async function handleOrderContactSubmit(payload: any) {
  const { orderId } = JSON.parse(payload.view.private_metadata);
  const values = payload.view.state.values;
  const client = getCsToolClient();

  for (const [blockId, blockValue] of Object.entries(values)) {
    if (!blockId.startsWith("contact_")) continue;
    const actionValue = Object.values(blockValue as any)[0] as any;
    const selected = actionValue?.selected_option?.value;
    if (!selected) continue;

    try {
      const parsed = JSON.parse(selected);
      if (parsed.id === "__direct_input__") continue;
      await client.assignOrderContact(orderId, parsed.id);
    } catch (error) {
      logger.warn({ orderId, blockId, error }, "연락처 배정 개별 실패");
    }
  }

  logger.info({ orderId }, "주문 연락처 배정 완료");
  return null;
}
