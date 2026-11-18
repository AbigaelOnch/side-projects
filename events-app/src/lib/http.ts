import { NextResponse, type NextRequest } from "next/server";

/** Same-origin check for anything that changes data (no cross-site form posts). */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try { return new URL(origin).host === req.headers.get("host"); } catch { return false; }
}

export function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "local").trim();
}

export const forbidden = () => NextResponse.json({ error: "Not allowed" }, { status: 403 });

import { isAdmin } from "./admin";
export const ADMIN_COOKIE = "afro_admin";
export function adminOk(req: NextRequest): boolean {
  return sameOrigin(req) && isAdmin(req.cookies.get(ADMIN_COOKIE)?.value);
}
export const unauthorized = () => NextResponse.json({ error: "Sign in as admin first." }, { status: 401 });
