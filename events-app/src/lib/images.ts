// Flyer images: always re-encoded (so only real images are stored), resized, and saved under a random name (S-063).
import sharp from "sharp";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { safeFetch } from "./safefetch";

export const UPLOAD_DIR = () => path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "uploads");
export const MAX_UPLOAD = 10 * 1024 * 1024;

export class BadImage extends Error {}

export async function saveImage(buf: Buffer): Promise<{ name: string; jpeg: Buffer }> {
  if (buf.length > MAX_UPLOAD) throw new BadImage("That image is over 10 MB.");
  let jpeg: Buffer;
  try {
    const img = sharp(buf, { limitInputPixels: 50_000_000, failOn: "error" }).rotate();
    const meta = await img.metadata();
    if (!meta.width || !meta.height) throw new Error("no size");
    jpeg = await img.resize({ width: 1200, height: 1500, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  } catch {
    throw new BadImage("That file isn't an image we can use. Try a JPG or PNG screenshot.");
  }
  const name = `${crypto.randomBytes(12).toString("hex")}.jpg`;
  fs.mkdirSync(UPLOAD_DIR(), { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR(), name), jpeg);
  return { name, jpeg };
}

/** Download a page's event image (best effort; failures just mean no image). */
export async function fetchImage(url: string): Promise<string | null> {
  try {
    const r = await safeFetch(url, { maxBytes: MAX_UPLOAD, accept: "image/*", timeoutMs: 8000 });
    if (r.status !== 200 || !/^image\//.test(r.contentType)) return null;
    return (await saveImage(r.body)).name;
  } catch {
    return null;
  }
}
