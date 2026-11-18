import { NextResponse, type NextRequest } from "next/server";
import { submit } from "@/lib/submit";
import { clientIp, forbidden, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbidden();
  const body = await req.json().catch(() => null);
  const out = submit(body, clientIp(req));
  // A filled honeypot looks like success to the bot (S-065).
  if (out.status === "dropped") return NextResponse.json({ status: "queued", id: 0, newCity: null });
  const code = out.status === "queued" || out.status === "already" ? 200 : out.status === "limited" ? 429 : 400;
  return NextResponse.json(out, { status: code });
}
