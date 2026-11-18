import { NextResponse, type NextRequest } from "next/server";
import { login } from "@/lib/admin";
import { ADMIN_COOKIE, forbidden, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";
const MSG = {
  locked: "Too many wrong tries. Wait 15 minutes and try again.",
  wrong: "That passcode isn't right.",
  unset: "No admin passcode is set yet. Add ADMIN_PASSCODE (6+ characters) to .env.local and restart the app.",
};

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbidden();
  const body = (await req.json().catch(() => ({}))) as { passcode?: unknown };
  const r = login(typeof body.passcode === "string" ? body.passcode.slice(0, 200) : "");
  if (!r.ok) return NextResponse.json({ error: MSG[r.reason] }, { status: r.reason === "locked" ? 429 : 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, r.token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 24 * 3600, secure: req.nextUrl.protocol === "https:" });
  return res;
}
