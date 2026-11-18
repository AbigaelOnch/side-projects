// AI review (added 2026-11-17 at the owner's request): Claude checks each shared event when it arrives.
// Clear, real events go live straight away; doubtful ones wait for the owner; spam is rejected.
// Dating events always wait for the owner. If Claude can't be reached, the event simply waits in the queue.
import { db } from "./db";
import { ClaudeUnavailable, reviewWithClaude, type ReviewDecision } from "./claude";
import { geocodeEvent } from "./geocode";
import { priceLabel } from "./events";
import { fmtLongDate, fmtTime } from "./time";
import { flaggedWith, linkSeries } from "./dedupe";

export const aiReviewOn = () => (process.env.AI_REVIEW ?? "on").toLowerCase() !== "off";

type Row = {
  id: number; title: string; start_utc: string; tz: string; venue_name: string | null; address: string | null; online: number;
  category: string; price_min: number | null; price_text: string | null; organiser: string | null; description: string | null;
  image_path: string | null; status: string; city_id: number | null;
};

function note(id: number, by: "ai", text: string) {
  db().prepare("UPDATE events SET review_by = ?, review_note = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(by, text.slice(0, 300), id);
}

export async function reviewEvent(id: number): Promise<ReviewDecision["decision"] | "skipped"> {
  if (!aiReviewOn()) return "skipped";
  const e = db().prepare("SELECT * FROM events WHERE id = ? AND status = 'pending'").get(id) as Row | undefined;
  if (!e) return "skipped";
  if (e.category === "dating") { note(id, "ai", "Dating events are always checked by you."); return "hold"; }
  const twin = flaggedWith(id);
  if (twin) { note(id, "ai", `Possible duplicate of "${twin}". Merge or keep both.`); return "hold"; }
  if (!e.city_id && !e.online) { note(id, "ai", "It's in a city you don't cover yet."); return "hold"; }
  const source = (db().prepare("SELECT url FROM event_sources WHERE event_id = ? ORDER BY id LIMIT 1").get(id) as { url: string } | undefined)?.url ?? null;
  let d: ReviewDecision;
  try {
    d = await reviewWithClaude({
      title: e.title, when: `${fmtLongDate(e.start_utc, e.tz)} ${fmtTime(e.start_utc, e.tz)}`,
      place: e.online ? "Online" : [e.venue_name, e.address].filter(Boolean).join(", "), category: e.category,
      price: priceLabel(e) ?? "not stated", organiser: e.organiser, description: e.description?.slice(0, 1500) ?? null, source, has_flyer: !!e.image_path,
    });
  } catch (err) {
    if (!(err instanceof ClaudeUnavailable)) throw err;
    note(id, "ai", "AI review wasn't available, so this is waiting for you.");
    return "hold";
  }
  if (d.decision === "approve") {
    const r = db().prepare(`UPDATE events SET status = 'approved', auto_approved = 1, approved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'pending'`).run(id);
    if (r.changes) { note(id, "ai", d.reason); linkSeries(id); void geocodeEvent(id).catch(() => null); }
  } else if (d.decision === "reject") {
    const r = db().prepare("UPDATE events SET status = 'rejected', reject_reason = ? WHERE id = ? AND status = 'pending'").run(d.reason.slice(0, 300), id);
    if (r.changes) note(id, "ai", d.reason);
  } else note(id, "ai", d.reason);
  return d.decision;
}

export type AiDecision = { id: number; title: string; status: string; review_note: string | null; reviewed_at: string; start_utc: string; tz: string };
/** What the AI decided recently, for the owner to check and overrule. */
export function recentAiDecisions(limit = 20): AiDecision[] {
  return db().prepare(`SELECT id, title, status, review_note, reviewed_at, start_utc, tz FROM events
    WHERE review_by = 'ai' AND status IN ('approved','rejected') ORDER BY reviewed_at DESC, id DESC LIMIT ?`).all(limit) as AiDecision[];
}

/** The owner overrules an AI rejection. */
export function restore(id: number): boolean {
  const r = db().prepare(`UPDATE events SET status = 'approved', review_by = 'admin', approved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ? AND status = 'rejected'`).run(id);
  return r.changes === 1;
}

/** Events that arrived while AI review wasn't available (no key yet, service down) get their review now. */
export async function reviewWaiting(limit = 20): Promise<number> {
  if (!aiReviewOn() || !process.env.ANTHROPIC_API_KEY) return 0;
  const rows = db().prepare(`SELECT id FROM events WHERE status = 'pending' AND (review_by IS NULL OR review_note LIKE 'AI review wasn''t available%')
    ORDER BY id LIMIT ?`).all(limit) as { id: number }[];
  let n = 0;
  for (const r of rows) { try { await reviewEvent(r.id); n++; } catch { /* next */ } }
  return n;
}
