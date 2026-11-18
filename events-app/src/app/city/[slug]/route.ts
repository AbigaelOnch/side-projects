import { NextResponse, type NextRequest } from "next/server";
import { cityBySlug } from "@/lib/events";

// Remember the visitor's city on this device only (S-014).
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const city = cityBySlug(slug);
  const res = NextResponse.redirect(new URL(city ? `/?city=${city.slug}` : "/?pick=1", req.url), 303);
  if (city) res.cookies.set("city", city.slug, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  return res;
}
