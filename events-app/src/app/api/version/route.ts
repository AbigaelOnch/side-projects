import { NextResponse } from "next/server";
import { APP_NAME, VERSION } from "@/lib/config";

export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ app: APP_NAME, version: VERSION });
}
