// Fetch a public web page or image on behalf of a submitter, safely (S-062):
// http(s) only, no private/loopback/link-local addresses (checked at connect time, so redirects and
// DNS tricks are covered too), at most 3 redirects, 10 s, and a size cap.
import { Agent, fetch as ufetch } from "undici";
import dns from "node:dns";
import net from "node:net";

export class FetchRefused extends Error {}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 198 && (b === 18 || b === 19));
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff");
}

export function checkUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new FetchRefused("That doesn't look like a link."); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new FetchRefused("Only web links (http or https) can be read.");
  if (u.username || u.password) throw new FetchRefused("Links with a login in them can't be read.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new FetchRefused("That link points to a private address.");
  }
  if (net.isIP(host) && isPrivateIp(host)) throw new FetchRefused("That link points to a private address.");
  if (u.port && !["80", "443", "8080", "8443"].includes(u.port)) throw new FetchRefused("That link uses an unusual port.");
  return u;
}

const agent = new Agent({
  connect: {
    timeout: 8000,
    lookup(hostname, options, cb) {
      dns.lookup(hostname, { all: true }, (err, addrs) => {
        if (err) return cb(err, "", 4);
        const list = addrs as dns.LookupAddress[];
        const bad = list.find((a) => isPrivateIp(a.address));
        if (bad || !list.length) return cb(new FetchRefused("That link points to a private address."), "", 4);
        if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
        cb(null, list[0].address, list[0].family);
      });
    },
  },
});

const UA = "Mozilla/5.0 (compatible; AfroSocialBot/0.1; reads a single event page when someone shares it)";

export type Fetched = { url: string; status: number; contentType: string; body: Buffer };

export async function safeFetch(raw: string, opts: { maxBytes?: number; accept?: string; timeoutMs?: number } = {}): Promise<Fetched> {
  const maxBytes = opts.maxBytes ?? 3 * 1024 * 1024;
  const deadline = AbortSignal.timeout(opts.timeoutMs ?? 10000);
  let url = checkUrl(raw);
  for (let hop = 0; hop <= 3; hop++) {
    const res = await ufetch(url, {
      dispatcher: agent, redirect: "manual", signal: deadline,
      headers: { "user-agent": UA, accept: opts.accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "accept-language": "en-US,en;q=0.8" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop === 3) throw new FetchRefused("That link redirects too many times.");
      url = checkUrl(new URL(res.headers.get("location")!, url).toString());
      await res.body?.cancel();
      continue;
    }
    const len = Number(res.headers.get("content-length") || 0);
    if (len > maxBytes) throw new FetchRefused("That page is too large to read.");
    const chunks: Buffer[] = [];
    let total = 0;
    if (res.body) {
      for await (const chunk of res.body) {
        total += chunk.length;
        if (total > maxBytes) throw new FetchRefused("That page is too large to read.");
        chunks.push(Buffer.from(chunk));
      }
    }
    return { url: url.toString(), status: res.status, contentType: res.headers.get("content-type") || "", body: Buffer.concat(chunks) };
  }
  throw new FetchRefused("That link redirects too many times.");
}
