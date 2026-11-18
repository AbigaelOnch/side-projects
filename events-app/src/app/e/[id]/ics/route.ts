import { NextResponse, type NextRequest } from "next/server";
import { getEvent } from "@/lib/events";
import { buildIcs } from "@/lib/ics";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = getEvent(Number(id));
  if (!e) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = buildIcs({ ...e, url: e.sources[0]?.url }, req.nextUrl.hostname);
  const name = e.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "event";
  return new NextResponse(body, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.ics"` },
  });
}
