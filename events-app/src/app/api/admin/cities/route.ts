import { NextResponse, type NextRequest } from "next/server";
import { addCity } from "@/lib/admin";
import { adminOk, unauthorized } from "@/lib/http";

export async function POST(req: NextRequest) {
  if (!adminOk(req)) return unauthorized();
  const r = addCity(await req.json().catch(() => null));
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.message }, { status: 400 });
}
