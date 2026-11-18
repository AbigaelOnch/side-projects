import { NextResponse, type NextRequest } from "next/server";
import { feedPage } from "@/lib/feed";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const f = feedPage(sp, req.cookies.get("city")?.value, req.cookies.get("dating")?.value);
  if (!f.city) return NextResponse.json({ error: "Unknown city" }, { status: 400 });
  return NextResponse.json({ events: f.events, next: f.next });
}
