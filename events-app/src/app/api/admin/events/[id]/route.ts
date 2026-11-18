import { NextResponse, type NextRequest } from "next/server";
import { approve, reject, updateEvent } from "@/lib/admin";
import { geocodeEvent } from "@/lib/geocode";
import { adminOk, unauthorized } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminOk(req)) return unauthorized();
  const id = Number((await params).id);
  const body = (await req.json().catch(() => ({}))) as { action?: string; fields?: unknown; reason?: string };
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (body.action === "update" || (body.action === "approve" && body.fields)) {
    const u = updateEvent(id, body.fields);
    if (!u.ok) return NextResponse.json({ error: u.message }, { status: 400 });
    if (body.action === "update") { void geocodeEvent(id).catch(() => null); return NextResponse.json({ ok: true }); }
  }
  if (body.action === "approve") {
    if (!approve(id)) return NextResponse.json({ error: "That event was already handled." }, { status: 409 });
    void geocodeEvent(id).catch(() => null); // find its map location in the background
    return NextResponse.json({ ok: true });
  }
  if (body.action === "reject") {
    if (!reject(id, body.reason)) return NextResponse.json({ error: "That event was already handled." }, { status: 409 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
