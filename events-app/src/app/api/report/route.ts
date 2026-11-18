import { NextResponse, type NextRequest } from "next/server";
import { addReport } from "@/lib/admin";
import { hashIp, rateLimited } from "@/lib/submit";
import { clientIp, forbidden, sameOrigin } from "@/lib/http";

// Anyone can report an event; it goes to the admin and changes nothing publicly (S-095).
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbidden();
  const body = (await req.json().catch(() => ({}))) as { eventId?: unknown; reason?: unknown };
  if (rateLimited(`r:${hashIp(clientIp(req))}`)) return NextResponse.json({ error: "Too many reports — try again later." }, { status: 429 });
  const ok = addReport(Number(body.eventId), typeof body.reason === "string" ? body.reason : null);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
