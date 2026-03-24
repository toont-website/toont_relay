import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";
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
      await openContactEditModal(triggerId, contactId);
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
      after(async () => {
        await openTemplateSendModal(triggerId, orderId);
      });
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "assign_order_contact") {
      const triggerId = payload.trigger_id;
      const orderId = payload.actions[0].value;
      after(async () => {
        await openOrderContactModal(triggerId, orderId);
      });
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
  }

  return new NextResponse(null, { status: 200 });
}
