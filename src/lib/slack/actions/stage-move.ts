import { getCsToolClient } from "@/lib/cs-tool/client";
import { getSlackClient } from "@/lib/slack/client";
import { logger } from "@/lib/logger";

export async function handleMoveNextStage(
  triggerId: string,
  orderId: string
) {
  const client = getCsToolClient();
  const slackClient = getSlackClient();

  const [orderResult, stagesResult] = await Promise.all([
    client.getOrder(orderId),
    client.getStages(),
  ]);

  const order = orderResult.data;
  const stages = stagesResult.data ?? [];
  if (!order) return;

  // 현재 단계 찾기 → 다음 단계 결정
  const currentIdx = stages.findIndex((s) => s.id === order.currentStageId);
  const nextStage =
    currentIdx >= 0 && currentIdx < stages.length - 1
      ? stages[currentIdx + 1]
      : null;

  if (!nextStage) {
    await slackClient.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        title: { type: "plain_text", text: "단계 이동" },
        close: { type: "plain_text", text: "확인" },
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "이미 마지막 단계에 있어요." },
          },
        ],
      },
    });
    return;
  }

  // 체크리스트 미완료 체크
  const currentChecklist = order.checklistStatus.find(
    (cs) => cs.stageId === order.currentStageId
  );
  const hasIncomplete = currentChecklist ? !currentChecklist.complete : false;

  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${order.customerName}* · ${order.itemDescription ?? "-"}\n\n${order.currentStageName} → *${nextStage.name}*`,
      },
    },
  ];

  if (hasIncomplete) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "⚠️ 현재 단계의 체크리스트가 완료되지 않았어요.",
      },
    });
    blocks.push({
      type: "input",
      block_id: "skip_block",
      label: { type: "plain_text", text: "체크리스트 건너뛰기" },
      optional: true,
      element: {
        type: "checkboxes",
        action_id: "skip_checkbox",
        options: [
          {
            text: {
              type: "plain_text",
              text: "체크리스트 미완료 상태로 이동",
            },
            value: "skip",
          },
        ],
      },
    });
  }

  // 마감일 입력 (선택)
  blocks.push({
    type: "input",
    block_id: "deadline_block",
    label: { type: "plain_text", text: `${nextStage.name} 마감일 (선택)` },
    optional: true,
    element: {
      type: "datepicker",
      action_id: "deadline_picker",
      placeholder: { type: "plain_text", text: "미입력 시 자동 계산" },
    },
  });

  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "stage_move_modal",
      private_metadata: JSON.stringify({
        orderId,
        nextStageId: nextStage.id,
        nextStageName: nextStage.name,
        hasIncomplete,
      }),
      title: { type: "plain_text", text: "단계 이동" },
      submit: { type: "plain_text", text: "이동" },
      close: { type: "plain_text", text: "취소" },
      blocks,
    },
  });
}

export async function handleCompleteOrder(
  triggerId: string,
  orderId: string
) {
  const client = getCsToolClient();
  const slackClient = getSlackClient();

  const orderResult = await client.getOrder(orderId);
  const order = orderResult.data;
  if (!order) return;

  // 체크리스트 미완료 체크
  const currentChecklist = order.checklistStatus.find(
    (cs) => cs.stageId === order.currentStageId
  );
  const hasIncomplete = currentChecklist ? !currentChecklist.complete : false;

  if (hasIncomplete) {
    await slackClient.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: "complete_order_modal",
        private_metadata: JSON.stringify({ orderId }),
        title: { type: "plain_text", text: "주문 완료" },
        submit: { type: "plain_text", text: "완료 처리" },
        close: { type: "plain_text", text: "취소" },
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${order.customerName}* · ${order.itemDescription ?? "-"}\n\n⚠️ 현재 단계의 체크리스트가 완료되지 않았어요.`,
            },
          },
          {
            type: "input",
            block_id: "skip_block",
            label: { type: "plain_text", text: "체크리스트 건너뛰기" },
            optional: true,
            element: {
              type: "checkboxes",
              action_id: "skip_checkbox",
              options: [
                {
                  text: {
                    type: "plain_text",
                    text: "체크리스트 미완료 상태로 완료 처리",
                  },
                  value: "skip",
                },
              ],
            },
          },
        ],
      },
    });
    return;
  }

  // 체크리스트 완료 상태면 바로 완료 처리
  try {
    await client.updateOrder(orderId, { status: "completed" });
    logger.info({ orderId }, "주문 완료 처리");
    await slackClient.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        title: { type: "plain_text", text: "완료" },
        close: { type: "plain_text", text: "닫기" },
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "✅ 주문을 완료 처리했어요." },
          },
        ],
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ error: msg, orderId }, "주문 완료 처리 실패");
    await slackClient.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        title: { type: "plain_text", text: "오류" },
        close: { type: "plain_text", text: "닫기" },
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `주문 완료 처리 실패: ${msg}` },
          },
        ],
      },
    });
  }
}

export async function handleCompleteOrderSubmit(payload: any) {
  let metadata: any;
  try {
    metadata = JSON.parse(payload.view.private_metadata);
  } catch {
    logger.error("private_metadata 파싱 실패 (handleCompleteOrderSubmit)");
    return null;
  }
  const { orderId } = metadata;
  const values = payload.view.state.values;

  const skipChecklist =
    (values.skip_block?.skip_checkbox?.selected_options?.length ?? 0) > 0;

  if (!skipChecklist) {
    return {
      response_action: "errors",
      errors: {
        skip_block:
          "체크리스트를 먼저 완료하거나, 건너뛰기를 선택해주세요.",
      },
    };
  }

  const client = getCsToolClient();

  try {
    await client.updateOrder(orderId, { status: "completed" });
    logger.info({ orderId, skipChecklist }, "주문 완료 처리");
    return {
      response_action: "update",
      view: {
        type: "modal",
        title: { type: "plain_text", text: "완료" },
        close: { type: "plain_text", text: "닫기" },
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "✅ 주문을 완료 처리했어요." },
          },
        ],
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ error: msg, orderId }, "주문 완료 처리 실패");
    return {
      response_action: "errors",
      errors: { skip_block: `완료 처리 실패: ${msg}` },
    };
  }
}

export async function handleStageMoveSubmit(payload: any) {
  let metadata: any;
  try {
    metadata = JSON.parse(payload.view.private_metadata);
  } catch {
    logger.error("private_metadata 파싱 실패 (handleStageMoveSubmit)");
    return null;
  }
  const { orderId, nextStageId, nextStageName, hasIncomplete } = metadata;
  const values = payload.view.state.values;

  const skipChecklist = hasIncomplete
    ? (values.skip_block?.skip_checkbox?.selected_options?.length ?? 0) > 0
    : false;

  if (hasIncomplete && !skipChecklist) {
    return {
      response_action: "errors",
      errors: {
        skip_block:
          "체크리스트를 먼저 완료하거나, 건너뛰기를 선택해주세요.",
      },
    };
  }

  const deadline = values.deadline_block?.deadline_picker?.selected_date;

  const client = getCsToolClient();

  try {
    await client.updateOperationStatus(orderId, {
      stageId: nextStageId,
      ...(deadline ? { stageDeadline: deadline } : {}),
      ...(skipChecklist ? { skipChecklist: true } : {}),
    });

    logger.info({ orderId, nextStageId, skipChecklist }, "단계 이동 완료");
    return {
      response_action: "update",
      view: {
        type: "modal",
        title: { type: "plain_text", text: "완료" },
        close: { type: "plain_text", text: "닫기" },
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `${nextStageName ?? "다음"} 단계로 이동했어요.` },
          },
        ],
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ error: msg, orderId }, "단계 이동 실패");
    return {
      response_action: "errors",
      errors: { deadline_block: `단계 이동 실패: ${msg}` },
    };
  }
}
