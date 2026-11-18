import { NextResponse, type NextRequest } from "next/server";
import { addOrg, checkOrg, removeOrg, setTrusted } from "@/lib/orgs";
import { adminOk, unauthorized } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!adminOk(req)) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as { action?: string; id?: number; trusted?: boolean; page_url?: string; name?: string; city_id?: number | null };
  if (b.action === "add") {
    const r = addOrg({ page_url: b.page_url, name: b.name || undefined, city_id: b.city_id ?? null, trusted: !!b.trusted });
    if (!r.ok) return NextResponse.json({ error: r.message }, { status: 400 });
    void checkOrg(r.id!, { manual: true }).catch(() => null); // first look, in the background
    return NextResponse.json({ ok: true });
  }
  if (b.action === "check") {
    const r = await checkOrg(Number(b.id), { manual: true });
    return NextResponse.json({ ok: true, message: r.message });
  }
  if (b.action === "trust") return setTrusted(Number(b.id), !!b.trusted) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  if (b.action === "remove") return removeOrg(Number(b.id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
