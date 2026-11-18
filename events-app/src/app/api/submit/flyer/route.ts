import { NextResponse, type NextRequest } from "next/server";
import { readFlyerBuffer } from "@/lib/submit";
import { MAX_UPLOAD } from "@/lib/images";
import { forbidden, sameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return forbidden();
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_UPLOAD + 100_000) return NextResponse.json({ status: "error", message: "That image is over 10 MB." }, { status: 413 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("flyer");
  if (!file || typeof file === "string") return NextResponse.json({ status: "error", message: "Choose an image first." }, { status: 400 });
  if (file.size > MAX_UPLOAD) return NextResponse.json({ status: "error", message: "That image is over 10 MB." }, { status: 413 });
  const source = typeof form?.get("source") === "string" ? String(form!.get("source")).slice(0, 2000) || null : null;
  const buf = Buffer.from(await file.arrayBuffer());
  return NextResponse.json(await readFlyerBuffer(buf, source && /^https?:\/\//i.test(source) ? source : null));
}
