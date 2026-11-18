import { NextResponse, type NextRequest } from "next/server";
import { keepBoth, mergeEvents, unmerge } from "@/lib/dedupe";
import { recreateFromMerge } from "@/lib/submit";
import { adminOk, unauthorized } from "@/lib/http";

export async function POST(req: NextRequest) {
  if (!adminOk(req)) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { action?: string; flagId?: number; keepId?: number; dropId?: number; mergeId?: number };
  const ok = b.action === "merge" ? mergeEvents(Number(b.keepId), Number(b.dropId))
    : b.action === "keep" ? keepBoth(Number(b.flagId))
    : b.action === "unmerge" ? unmerge(Number(b.mergeId), recreateFromMerge) : false;
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "That was already handled." }, { status: 409 });
}
