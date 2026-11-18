import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "uploads");
const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

// Serves stored flyer images. Only plain generated file names; no paths.
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const m = /^[a-z0-9_-]{1,80}\.(jpg|jpeg|png|webp)$/i.exec(name);
  if (!m) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const file = path.join(DIR, name);
  if (!fs.existsSync(file)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(fs.readFileSync(file)), {
    headers: { "Content-Type": TYPES[m[1].toLowerCase()], "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff" },
  });
}
