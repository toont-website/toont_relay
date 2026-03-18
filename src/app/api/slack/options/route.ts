import { NextRequest, NextResponse } from "next/server";
import { parseSlackRequest } from "@/lib/slack/verify";
import { searchContacts } from "@/lib/slack/options/contacts";

export async function POST(request: NextRequest) {
  const result = await parseSlackRequest(request);
  if (result instanceof NextResponse) return result;

  const { payload } = result;
  if (!payload) return NextResponse.json({ options: [] });

  const query = payload.value ?? "";
  const searchResult = await searchContacts(query);

  return NextResponse.json(searchResult);
}
