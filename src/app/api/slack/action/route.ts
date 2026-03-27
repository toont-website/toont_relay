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
      const orderId = payload.actions[0].value;
      const responseUrl = payload.response_url;
      if (responseUrl) {
        after(async () => {
          try {
            await handleCopyTemplate(orderId, responseUrl);
          } catch (error) {
            logger.error({ error, orderId }, "템플릿 복사 실패");
          }
        });
      }
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "send_template_sms") {
      const triggerId = payload.trigger_id;
      const orderId = payload.actions[0].value;
      try {
        await openTemplateSendModal(triggerId, orderId);
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
      try {
        await openChecklistModal(triggerId, orderId);
      } catch (error) {
        logger.error({ error, actionId }, "모달 오픈 실패");
      }
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "move_next_stage") {
      const triggerId = payload.trigger_id;
      const orderId = payload.actions[0].value;
      try {
        await handleMoveNextStage(triggerId, orderId);
      } catch (error) {
        logger.error({ error, actionId }, "모달 오픈 실패");
      }
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "complete_order") {
      const triggerId = payload.trigger_id;
      const orderId = payload.actions[0].value;
      try {
        await handleCompleteOrder(triggerId, orderId);
      } catch (error) {
        logger.error({ error, actionId }, "모달 오픈 실패");
      }
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "assign_order_contact") {
      const triggerId = payload.trigger_id;
      const orderId = payload.actions[0].value;
      try {
        await openOrderContactModal(triggerId, orderId);
      } catch (error) {
        logger.error({ error, actionId }, "모달 오픈 실패");
      }
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
