import { NextResponse, type NextRequest } from "next/server";
import { readLink } from "@/lib/submit";
import { forbidden, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbidden();
  const body = (await req.json().catch(() => ({}))) as { url?: unknown };
  const url = typeof body.url === "string" ? body.url.slice(0, 2000) : "";
  if (!url.trim()) return NextResponse.json({ status: "error", message: "Paste a link first." }, { status: 400 });
  try {
    return NextResponse.json(await readLink(url));
  } catch {
    return NextResponse.json({ status: "unreachable", message: "We couldn't open that link. Add a screenshot of the flyer instead, or fill it in yourself." });
  }
}
