import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";
import { validateSmsSend, executeSmsSend } from "@/lib/slack/actions/sms-send";
import { handleReplySms, handleRetrySms } from "@/lib/slack/actions/reply-sms";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { payload } = result;
  if (!payload) return NextResponse.json({ error: "No payload" }, { status: 400 });

  if (payload.type === "view_submission") {
    const callbackId = payload.view?.callback_id;
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
    if (actionId === "reply_sms") {
      await handleReplySms(payload);
      return new NextResponse(null, { status: 200 });
    }
    if (actionId === "retry_sms") {
      await handleRetrySms(payload);
      return new NextResponse(null, { status: 200 });
    }
  }

  return new NextResponse(null, { status: 200 });
}
