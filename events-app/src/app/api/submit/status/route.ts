import { NextResponse, type NextRequest } from "next/server";
import { liveStatus } from "@/lib/review";

export const dynamic = "force-dynamic";
export function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  return NextResponse.json({ status: Number.isInteger(id) && id > 0 ? liveStatus(id) : "gone" });
}
