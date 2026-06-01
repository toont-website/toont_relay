import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";
import { logger } from "@/lib/logger";
import { validateSmsSend, executeSmsSend } from "@/lib/slack/actions/sms-send";
import { handleReplySms, handleRetrySms } from "@/lib/slack/actions/reply-sms";
import {
  validateOrderAdd,
  executeOrderAdd,
  handleProductSelect,
  handleProfileSelect,
  handleCustomerContactSelect,
  handleFreightContactSelect,
} from "@/lib/slack/commands/order";
import { handleStockSubmission } from "@/lib/slack/commands/inventory";
import { handleContactSelect } from "@/lib/slack/commands/sms";
import {
  openContactAddModal,
  handleContactAddSubmit,
  openContactEditModal,
  handleContactEditSubmit,
} from "@/lib/slack/commands/contact";
import { handleContactTypeAddSubmit } from "@/lib/slack/commands/contact-type";
import {
  openOrderContactModal,
  handleOrderContactSubmit,
} from "@/lib/slack/actions/order-contact";
import {
  handleCopyTemplate,
  openTemplateSendModal,
  validateTemplateSms,
  executeTemplateSms,
} from "@/lib/slack/actions/template-send";
import {
  openChecklistModal,
  handleChecklistSubmit,
} from "@/lib/slack/actions/checklist";
import {
  handleMoveNextStage,
  handleStageMoveSubmit,
  handleCompleteOrder,
  handleCompleteOrderSubmit,
} from "@/lib/slack/actions/stage-move";
import {
  openProfileEditModal,
  handleProfileEditSubmit,
} from "@/lib/slack/commands/profile";
import {
  executePartnerChatReply,
  handleReplyPartnerChat,
} from "@/lib/slack/actions/partner-chat-reply";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { payload } = result;
  if (!payload) return NextResponse.json({ error: "No payload" }, { status: 400 });

  if (payload.type === "view_submission") {
    const callbackId = payload.view?.callback_id;
    if (callbackId === "order_add_modal") {
      const result = await validateOrderAdd(payload);
      if ("response_action" in result) {
        return NextResponse.json(result);
      }
      after(async () => {
        await executeOrderAdd(result);
      });
      return new NextResponse(null, { status: 200 });
    }
    if (callbackId === "contact_type_add_modal") {
      const response = await handleContactTypeAddSubmit(payload);
      if (response) return NextResponse.json(response);
      return new NextResponse(null, { status: 200 });
    }
    if (callbackId === "contact_add_modal" || callbackId === "register_contact_modal") {
      const response = await handleContactAddSubmit(payload);
      if (response) return NextResponse.json(response);
      return new NextResponse(null, { status: 200 });
    }
    if (callbackId === "contact_edit_modal") {
      const response = await handleContactEditSubmit(payload);
      if (response) return NextResponse.json(response);
      return new NextResponse(null, { status: 200 });
    }
    if (callbackId === "stock_in_modal") {
      const response = await handleStockSubmission(payload, "inbound");
      if (response) return NextResponse.json(response);
      return new NextResponse(null, { status: 200 });
    }
    if (callbackId === "stock_out_modal") {
      const response = await handleStockSubmission(payload, "outbound");
      if (response) return NextResponse.json(response);
      return new NextResponse(null, { status: 200 });
    }
    if (callbackId === "order_contact_modal") {
      const response = await handleOrderContactSubmit(payload);
      if (response) return NextResponse.json(response);
      return new NextResponse(null, { status: 200 });
    }
    if (callbackId === "template_sms_modal") {
      const result = await validateTemplateSms(payload);
      if (result) return NextResponse.json(result);
      return new NextResponse(null, { status: 200 });
    }
    if (callbackId === "template_sms_confirm") {
      after(async () => {
        try {
          await executeTemplateSms(payload);
        } catch (error) {
          logger.error({ error }, "템플릿 SMS 발송 실패");
        }
      });
      return NextResponse.json({ response_action: "clear" });
    }
    if (callbackId === "checklist_modal") {
      const response = await handleChecklistSubmit(payload);
      if (response) return NextResponse.json(response);
      return new NextResponse(null, { status: 200 });
    }
    if (callbackId === "stage_move_modal") {
      const response = await handleStageMoveSubmit(payload);
      if (response) return NextResponse.json(response);
      return new NextResponse(null, { status: 200 });
    }
    if (callbackId === "complete_order_modal") {
      const response = await handleCompleteOrderSubmit(payload);
      if (response) return NextResponse.json(response);
      return new NextResponse(null, { status: 200 });
    }
    if (callbackId === "profile_edit_modal") {
      const response = await handleProfileEditSubmit(payload);
      if (response) return NextResponse.json(response);
      return new NextResponse(null, { status: 200 });
    }
    if (callbackId === "partner_chat_reply_modal") {
      const response = await executePartnerChatReply(payload);
      if (response) return NextResponse.json(response);
      return new NextResponse(null, { status: 200 });
    }
    if (callbackId === "sms_send_modal") {
      const result = await validateSmsSend(payload);
      if ("response_action" in result) {
        return NextResponse.json(result);
      }
      after(async () => {
        await executeSmsSend(result);
      });
      return new NextResponse(null, { status: 200 });
    }
  }

  if (payload.type === "block_actions") {
    const actionId = payload.actions?.[0]?.action_id;
    if (actionId === "register_contact") {
      const triggerId = payload.trigger_id;
      let phoneNumber: string | undefined;
      try {
        const parsed = JSON.parse(payload.actions[0].value);
        phoneNumber = parsed.phoneNumber;
      } catch { /* ignore */ }
      await openContactAddModal(triggerId, phoneNumber);
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "edit_contact") {
      const triggerId = payload.trigger_id;
      const contactId = payload.actions[0].value;
      try {
        await openContactEditModal(triggerId, contactId);
      } catch (error) {
        logger.error({ error, actionId }, "모달 오픈 실패");
      }
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "contact_select") {
      after(async () => {
        try {
          await handleContactSelect(payload);
        } catch (error) {
          logger.error({ error }, "연락처 선택 처리 실패");
        }
      });
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "reply_sms") {
      await handleReplySms(payload);
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "reply_partner_chat") {
      await handleReplyPartnerChat(payload);
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "retry_sms") {
      after(async () => {
        try {
          await handleRetrySms(payload);
        } catch (error) {
          logger.error({ error }, "SMS 재시도 실패");
        }
      });
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "customer_contact_select") {
      after(async () => {
        try {
          await handleCustomerContactSelect(payload);
        } catch (error) {
          logger.error({ error }, "주문자 선택 처리 실패");
        }
      });
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "freight_contact_select") {
      after(async () => {
        try {
          await handleFreightContactSelect(payload);
        } catch (error) {
          logger.error({ error }, "화물 선택 처리 실패");
        }
      });
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "product_select") {
      after(async () => {
        try {
          await handleProductSelect(payload);
        } catch (error) {
          logger.error({ error }, "상품 선택 처리 실패");
        }
      });
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "profile_select") {
      after(async () => {
        try {
          await handleProfileSelect(payload);
        } catch (error) {
          logger.error({ error }, "프로필 선택 처리 실패");
        }
      });
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "copy_template") {
      const rawValue = payload.actions[0].value;
      const responseUrl = payload.response_url;
      if (responseUrl) {
        after(async () => {
          try {
            let orderId = rawValue;
            let templateIndex: number | undefined;
            try {
              const parsed = JSON.parse(rawValue);
              orderId = parsed.orderId;
              templateIndex = parsed.templateIndex;
            } catch { /* 하위호환: 순수 orderId 문자열 */ }
            await handleCopyTemplate(orderId, responseUrl, templateIndex);
          } catch (error) {
            logger.error({ error }, "템플릿 복사 실패");
          }
        });
      }
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "send_template_sms") {
      const triggerId = payload.trigger_id;
      const rawValue = payload.actions[0].value;
      const fromModal = !!payload.view;
      try {
        let orderId = rawValue;
        let templateIndex: number | undefined;
        try {
          const parsed = JSON.parse(rawValue);
          orderId = parsed.orderId;
          templateIndex = parsed.templateIndex;
        } catch { /* 하위호환: 순수 orderId 문자열 */ }
        await openTemplateSendModal(triggerId, orderId, templateIndex, fromModal);
      } catch (error) {
        logger.error({ error, actionId }, "모달 오픈 실패");
      }
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "edit_profile") {
      const triggerId = payload.trigger_id;
      const profileId = payload.actions[0].value;
      try {
        await openProfileEditModal(triggerId, profileId);
      } catch (error) {
        logger.error({ error, actionId }, "모달 오픈 실패");
      }
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "open_checklist") {
      const triggerId = payload.trigger_id;
      const orderId = payload.actions[0].value;
      const fromModal = !!payload.view;
      try {
        await openChecklistModal(triggerId, orderId, fromModal);
      } catch (error) {
        logger.error({ error, actionId }, "모달 오픈 실패");
      }
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "move_next_stage") {
      const triggerId = payload.trigger_id;
      const orderId = payload.actions[0].value;
      const fromModal = !!payload.view;
      try {
        await handleMoveNextStage(triggerId, orderId, fromModal);
      } catch (error) {
        logger.error({ error, actionId }, "모달 오픈 실패");
      }
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "complete_order") {
      const triggerId = payload.trigger_id;
      const orderId = payload.actions[0].value;
      const fromModal = !!payload.view;
      try {
        await handleCompleteOrder(triggerId, orderId, fromModal);
      } catch (error) {
        logger.error({ error, actionId }, "모달 오픈 실패");
      }
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "assign_order_contact") {
      const triggerId = payload.trigger_id;
      const orderId = payload.actions[0].value;
      const fromModal = !!payload.view;
      try {
        await openOrderContactModal(triggerId, orderId, fromModal);
      } catch (error) {
        logger.error({ error, actionId }, "모달 오픈 실패");
      }
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "start_order") {
      const orderId = payload.actions[0].value;
      const viewId = payload.view?.id;
      after(async () => {
        try {
          const { getCsToolClient } = await import("@/lib/cs-tool/client");
          const { getSlackClient } = await import("@/lib/slack/client");
          const client = getCsToolClient();
          const slackClient = getSlackClient();

          // 첫 번째 단계(접수) 조회
          const stagesResult = await client.getStages();
          const stages = stagesResult.data ?? [];
          const firstStage = stages.sort((a, b) => a.position - b.position)[0];
          if (!firstStage) {
            logger.error({ orderId }, "접수 시작 실패: 단계 없음");
            return;
          }

          await client.updateOperationStatus(orderId, { stageId: firstStage.id });
          logger.info({ orderId, stageId: firstStage.id }, "접수 시작 완료");

          // 모달 새로고침
          if (viewId) {
            const { openOrderDetailModal } = await import("@/lib/slack/messages/order-detail");
            const orderResult = await client.getOrder(orderId);
            if (orderResult.data) {
              const { buildOrderDetailModalBlocks } = await import("@/lib/slack/messages/order-detail");
              const blocks = buildOrderDetailModalBlocks(orderResult.data);
              const titleText = `주문 — ${orderResult.data.customerName}`.slice(0, 24);
              await slackClient.views.update({
                view_id: viewId,
                view: {
                  type: "modal",
                  title: { type: "plain_text", text: titleText },
                  close: { type: "plain_text", text: "닫기" },
                  blocks,
                },
              });
            }
          }
        } catch (error) {
          logger.error({ error, orderId }, "접수 시작 실패");
        }
      });
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "delete_order") {
      const orderId = payload.actions[0].value;
      after(async () => {
        try {
          const { getCsToolClient } = await import("@/lib/cs-tool/client");
          const { getSlackClient } = await import("@/lib/slack/client");
          const client = getCsToolClient();
          const slackClient = getSlackClient();

          // 삭제 전 주문 정보 조회
          const orderResult = await client.getOrder(orderId);
          const customerName = orderResult.data?.customerName ?? "주문";

          await client.deleteOrder(orderId);
          logger.info({ orderId, customerName }, "주문 삭제 완료");

          // 삭제 후 모달 업데이트 (view_id로)
          const viewId = payload.view?.id;
          if (viewId) {
            await slackClient.views.update({
              view_id: viewId,
              view: {
                type: "modal",
                title: { type: "plain_text", text: "삭제 완료" },
                close: { type: "plain_text", text: "닫기" },
                blocks: [
                  {
                    type: "section",
                    text: { type: "mrkdwn", text: `*${customerName}* 주문을 삭제했어요.` },
                  },
                ],
              },
            });
          }
        } catch (error) {
          logger.error({ error, orderId }, "주문 삭제 실패");
        }
      });
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "view_order_detail") {
      const triggerId = payload.trigger_id;
      const orderId = payload.actions[0].value;
      try {
        const { openOrderDetailModal } = await import("@/lib/slack/messages/order-detail");
        await openOrderDetailModal(triggerId, orderId);
      } catch (error) {
        logger.error({ error, orderId }, "주문 상세 모달 오픈 실패");
      }
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "order_page_prev" || actionId === "order_page_next") {
      const responseUrl = payload.response_url;
      after(async () => {
        try {
          const { page, search } = JSON.parse(payload.actions[0].value);
          const { handleOrderCommand } = await import("@/lib/slack/commands/order");
          const message = await handleOrderCommand(search ?? "", page);
          const { postToResponseUrl } = await import("@/lib/slack/deferred-response");
          await postToResponseUrl(responseUrl, { ...message, replace_original: true });
        } catch (error) {
          logger.error({ error }, "주문 페이지 이동 실패");
        }
      });
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "unassigned_detail") {
      const responseUrl = payload.response_url;
      after(async () => {
        try {
          const { getCsToolClient } = await import("@/lib/cs-tool/client");
          const { postToResponseUrl } = await import("@/lib/slack/deferred-response");
          const { formatPhoneNumber } = await import("@/lib/utils/phone");
          const { getOrderChannel } = await import("@/lib/cs-tool/types");
          const client = getCsToolClient();

          const ordersResult = await client.getOrders({ status: "pending", limit: "50" });
          const unassigned = (ordersResult.data ?? []).filter((o) => !o.currentStageId);

          const blocks: Array<Record<string, unknown>> = [
            { type: "header", text: { type: "plain_text", text: "⚪ 미배정 주문 상세" } },
            { type: "divider" },
          ];

          for (const order of unassigned.slice(0, 15)) {
            const phone = order.phone ? formatPhoneNumber(order.phone) : "";
            const channel = getOrderChannel(order);
            const productName = order.productNames ?? order.itemDescription ?? "-";
            const deadline = order.dueDate ?? "-";

            blocks.push(
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `👤 *${order.customerName}*${phone ? ` (${phone})` : ""}\n📦 ${channel ? `${channel} / ` : ""}${productName} x${order.quantity}${order.itemDescription && order.productNames ? `\n📝 ${order.itemDescription}` : ""}\n📅 납기: ${deadline}`,
                },
              },
              {
                type: "actions",
                elements: [
                  {
                    type: "button",
                    text: { type: "plain_text", text: "주문 상세" },
                    action_id: "view_order_detail",
                    value: order.id,
                  },
                  {
                    type: "button",
                    text: { type: "plain_text", text: "접수 시작" },
                    action_id: "start_order",
                    value: order.id,
                    style: "primary",
                  },
                ],
              },
              { type: "divider" },
            );
          }

          if (unassigned.length === 0) {
            blocks.push({
              type: "section",
              text: { type: "mrkdwn", text: "_미배정 주문이 없어요._" },
            });
          }

          if (blocks.length > 48) {
            blocks.length = 47;
            blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "_...일부 주문이 생략됐어요._" }] });
          }

          await postToResponseUrl(responseUrl, { response_type: "ephemeral", replace_original: false, text: " ", blocks });
        } catch (error) {
          logger.error({ error }, "미배정 상세 조회 실패");
        }
      });
      return new NextResponse(null, { status: 200 });
    }
    // stage_detail_* 동적 액션 — 칸반 단계별 상세 조회
    if (actionId?.startsWith("stage_detail_")) {
      const stageId = payload.actions[0].value;
      const responseUrl = payload.response_url;
      after(async () => {
        try {
          const { getCsToolClient } = await import("@/lib/cs-tool/client");
          const { buildStageDetailMessage } = await import("@/lib/slack/messages/operation");
          const { postToResponseUrl } = await import("@/lib/slack/deferred-response");
          const client = getCsToolClient();
          const result = await client.getOperations({ stageId });
          const board = result.data;
          if (!board || !responseUrl) return;
          const stageData = board.stages.find((s) => s.id === stageId);
          if (!stageData) return;
          const maxPos = Math.max(...board.stages.map((s) => s.position));
          const message = buildStageDetailMessage(stageData, stageData.position === maxPos);
          await postToResponseUrl(responseUrl, { ...message, replace_original: false });
        } catch (error) {
          logger.error({ error, stageId }, "단계 상세 조회 실패");
        }
      });
      return new NextResponse(null, { status: 200 });
    }
  }

  return new NextResponse(null, { status: 200 });
}
