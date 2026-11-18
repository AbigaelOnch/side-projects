import { NextResponse, type NextRequest } from "next/server";
import { resolveReport } from "@/lib/admin";
import { adminOk, unauthorized } from "@/lib/http";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminOk(req)) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { remove?: boolean };
  return resolveReport(Number((await params).id), body.remove === true)
    ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Already handled." }, { status: 409 });
}
