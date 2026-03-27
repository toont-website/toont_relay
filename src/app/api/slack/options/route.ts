import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";
import { searchContacts } from "@/lib/slack/options/cs-contacts";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { payload } = result;
  if (!payload) return NextResponse.json({ options: [] });

  const query = payload.value ?? "";
  const actionId = payload.action_id ?? "";

  let contactType: string | undefined;
  if (actionId === "customer_contact_select") {
    contactType = "customer";
  } else if (actionId === "freight_contact_select") {
    contactType = "freight";
  }

  const searchResult = await searchContacts(query, contactType);

  return NextResponse.json(searchResult);
}
