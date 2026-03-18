import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";
import { handleSmsSendSubmission } from "@/lib/slack/actions/sms-send";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { payload } = result;
  if (!payload) return NextResponse.json({ error: "No payload" }, { status: 400 });

  if (payload.type === "view_submission") {
    const callbackId = payload.view?.callback_id;
    if (callbackId === "sms_send_modal") {
      const response = await handleSmsSendSubmission(payload);
      if (response) return NextResponse.json(response);
      return new NextResponse(null, { status: 200 });
    }
  }

  return new NextResponse(null, { status: 200 });
}
