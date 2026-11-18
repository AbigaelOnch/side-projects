import { NextResponse, type NextRequest } from "next/server";

// "Show dating events" is remembered on this device (S-090).
export async function GET(req: NextRequest) {
  const on = req.nextUrl.searchParams.get("on") === "1";
  const next = req.nextUrl.searchParams.get("next") || "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const res = NextResponse.redirect(new URL(safeNext, req.url), 303);
  res.cookies.set("dating", on ? "1" : "0", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  return res;
}
