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
} from "@/lib/slack/commands/order";
import { handleStockSubmission } from "@/lib/slack/commands/inventory";
import { handleContactSelect } from "@/lib/slack/commands/sms";
import {
  openContactAddModal,
  handleContactAddSubmit,
  openContactEditModal,
  handleContactEditSubmit,
} from "@/lib/slack/commands/contact";
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
        await executeTemplateSms(payload);
      });
      return new NextResponse(null, { status: 200 });
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
      await handleContactSelect(payload);
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "reply_sms") {
      await handleReplySms(payload);
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "retry_sms") {
      await handleRetrySms(payload);
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "product_select") {
      after(async () => {
        await handleProductSelect(payload);
      });
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "profile_select") {
      after(async () => {
        await handleProfileSelect(payload);
      });
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "copy_template") {
      const orderId = payload.actions[0].value;
      const channelId = payload.channel?.id ?? payload.container?.channel_id;
      const userId = payload.user?.id;
      if (channelId && userId) {
        after(async () => {
          await handleCopyTemplate(orderId, userId, channelId);
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
      const orderId = payload.actions[0].value;
      const channelId = payload.channel?.id ?? payload.container?.channel_id;
      const userId = payload.user?.id;
      after(async () => {
        const { getCsToolClient } = await import("@/lib/cs-tool/client");
        const { buildOrderDetailMessage } = await import("@/lib/slack/messages/order-detail");
        const { getSlackClient } = await import("@/lib/slack/client");
        const client = getCsToolClient();
        const result = await client.getOrder(orderId);
        if (!result.data || !channelId || !userId) return;
        const message = buildOrderDetailMessage(result.data);
        const slackClient = getSlackClient();
        await slackClient.chat.postEphemeral({
          channel: channelId,
          user: userId,
          ...message,
        });
      });
      return new NextResponse(null, { status: 200 });
    }
    // stage_detail_* 동적 액션 — 칸반 단계별 상세 조회
    if (actionId?.startsWith("stage_detail_")) {
      const stageId = payload.actions[0].value;
      const channelId = payload.channel?.id ?? payload.container?.channel_id;
      const userId = payload.user?.id;
      after(async () => {
        const { getCsToolClient } = await import("@/lib/cs-tool/client");
        const { buildStageDetailMessage } = await import("@/lib/slack/messages/operation");
        const { getSlackClient } = await import("@/lib/slack/client");
        const client = getCsToolClient();
        const result = await client.getOperations({ stageId });
        const board = result.data;
        if (!board || !channelId || !userId) return;
        const stageData = board.stages.find((s) => s.id === stageId);
        if (!stageData) return;
        const message = buildStageDetailMessage(stageData);
        const slackClient = getSlackClient();
        await slackClient.chat.postEphemeral({
          channel: channelId,
          user: userId,
          ...message,
        });
      });
      return new NextResponse(null, { status: 200 });
    }
  }

  return new NextResponse(null, { status: 200 });
}
