import { NextResponse, type NextRequest } from "next/server";
import { logout } from "@/lib/admin";
import { ADMIN_COOKIE, forbidden, sameOrigin } from "@/lib/http";

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbidden();
  logout(req.cookies.get(ADMIN_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ADMIN_COOKIE);
  return res;
}
