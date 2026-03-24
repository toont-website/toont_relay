import { getCsToolClient } from "@/lib/cs-tool/client";
import { getSlackClient } from "@/lib/slack/client";
import { logger } from "@/lib/logger";

export async function openChecklistModal(triggerId: string, orderId: string) {
  const client = getCsToolClient();
  const slackClient = getSlackClient();
  const orderResult = await client.getOrder(orderId);
  const order = orderResult.data;
  if (!order) return;

  // 현재 단계의 체크리스트 찾기
  const currentChecklist = order.checklistStatus.find(
    (cs) => cs.stageId === order.currentStageId
  );
  if (!currentChecklist || currentChecklist.items.length === 0) return;

  const inputBlocks = currentChecklist.items.map((item) => {
    if (item.type === "checkbox") {
      return {
        type: "input",
        block_id: `check_${item.id}`,
        label: { type: "plain_text", text: item.label },
        optional: true,
        element: {
          type: "checkboxes",
          action_id: `checkbox_${item.id}`,
          options: [
            {
              text: { type: "plain_text", text: item.label },
              value: "checked",
            },
          ],
          ...(item.checked
            ? {
                initial_options: [
                  {
                    text: { type: "plain_text", text: item.label },
                    value: "checked",
                  },
                ],
              }
            : {}),
        },
      };
    }

    // text 타입
    return {
      type: "input",
      block_id: `text_${item.id}`,
      label: { type: "plain_text", text: item.label },
      optional: true,
      element: {
        type: "plain_text_input",
        action_id: `textinput_${item.id}`,
        ...(item.value ? { initial_value: item.value } : {}),
        placeholder: { type: "plain_text", text: `${item.label} 입력` },
      },
    };
  });

  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "checklist_modal",
      private_metadata: JSON.stringify({
        orderId,
        stageId: order.currentStageId,
      }),
      title: { type: "plain_text", text: "체크리스트" },
      submit: { type: "plain_text", text: "저장" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `*${order.customerName}* · ${order.currentStageName} 단계`,
            },
          ],
        },
        ...inputBlocks,
      ],
    },
  });
}

export async function handleChecklistSubmit(payload: any) {
  const { orderId, stageId } = JSON.parse(payload.view.private_metadata);
  const values = payload.view.state.values;

  const items: Array<{ id: string; checked?: boolean; value?: string }> = [];

  for (const [blockId, blockValue] of Object.entries(values)) {
    if (blockId.startsWith("check_")) {
      const itemId = blockId.replace("check_", "");
      const actionValue = Object.values(blockValue as any)[0] as any;
      const checked = (actionValue?.selected_options?.length ?? 0) > 0;
      items.push({ id: itemId, checked });
    } else if (blockId.startsWith("text_")) {
      const itemId = blockId.replace("text_", "");
      const actionValue = Object.values(blockValue as any)[0] as any;
      const value = actionValue?.value ?? "";
      items.push({ id: itemId, value });
    }
  }

  const client = getCsToolClient();
  await client.updateOrder(orderId, {
    checklistStatus: [{ stageId, items }],
  } as any);

  logger.info({ orderId, stageId, itemCount: items.length }, "체크리스트 저장");
  return null;
}
