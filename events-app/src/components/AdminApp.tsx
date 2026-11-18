"use client";
import { useState } from "react";
import type { QueueItem, ReportItem } from "@/lib/admin";
import type { AiDecision } from "@/lib/review";

type City = { id: number; name: string; tz: string };
const CATS = [["networking", "Networking"], ["career", "Career & tech"], ["social", "Social & culture"], ["wellness", "Wellness"], ["dating", "Dating"]] as const;

async function post(url: string, body: unknown): Promise<string | null> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return null;
    return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "That didn't work. Try again.";
  } catch { return "You seem to be offline."; }
}

export function AdminLogin({ unset }: { unset: boolean }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (unset) return <div className="note">No admin passcode is set yet. Open the file <b>.env.local</b> in the app folder, set <b>ADMIN_PASSCODE</b> to something only you know (6+ characters), then restart the app.</div>;
  return (
    <form className="sheet-body" onSubmit={async (e) => { e.preventDefault(); const m = await post("/api/admin/login", { passcode: code }); if (m) setErr(m); else window.location.reload(); }}>
      <label>Admin passcode
        <input type="password" autoComplete="current-password" value={code} onChange={(e) => setCode(e.target.value)} required />
      </label>
      {err && <p className="warn" role="alert">{err}</p>}
      <button type="submit" className="btn pink wide">Sign in</button>
    </form>
  );
}

export function AdminApp(p: { ai: AiDecision[]; aiOn: boolean; queue: QueueItem[]; reports: ReportItem[]; cities: City[]; noLocation: { id: number; title: string; address: string | null }[]; claude: boolean; approvedCount: number }) {
  const [err, setErr] = useState<string | null>(null);
  const done = (m: string | null) => { if (m) setErr(m); else window.location.reload(); };
  return (
    <div className="admin">
      {err && <p className="warn" role="alert">{err}</p>}
      {(p.cities.length === 0 || !p.claude || p.approvedCount === 0) && (
        <section className="note">
          <b style={{ color: "var(--ink)" }}>Getting set up</b>
          <ul className="checklist">
            <li data-done={p.cities.length > 0}>Add at least one city</li>
            <li data-done={p.claude}>Add your Claude key to .env.local (reads links and flyers)</li>
            <li data-done={p.approvedCount > 0}>Approve your first event</li>
          </ul>
        </section>
      )}

      <section>
        <h2>Waiting for you <span className="num">{p.queue.length}</span></h2>
        <p className="hint" style={{ marginBottom: 12 }}>{p.aiOn
          ? "AI review is on: clear events go live by themselves, and only the ones it isn't sure about wait here."
          : "AI review is off (it needs your Claude key in .env.local), so every shared event waits here."}</p>
        {p.queue.length === 0 && <p className="hint">Nothing is waiting.</p>}
        {p.queue.map((q) => <QueueCard key={q.id} q={q} cities={p.cities} done={done} />)}
      </section>

      <section>
        <h2>Reports <span className="num">{p.reports.length}</span></h2>
        {p.reports.length === 0 && <p className="hint">No open reports.</p>}
        {p.reports.map((r) => (
          <div key={r.id} className="qcard">
            <div><a href={`/e/${r.event_id}`}><b>{r.title}</b></a><div className="meta">{r.reason || "No reason given"}</div></div>
            <div className="qactions">
              <button type="button" className="btn" onClick={async () => done(await post(`/api/admin/reports/${r.id}`, { remove: false }))}>Keep event</button>
              <button type="button" className="btn danger" onClick={async () => done(await post(`/api/admin/reports/${r.id}`, { remove: true }))}>Remove event</button>
            </div>
          </div>
        ))}
      </section>

      <section>
        <h2>Decided by AI</h2>
        {p.ai.length === 0 && <p className="hint">Nothing yet. Events the AI approves or rejects are listed here so you can overrule it.</p>}
        {p.ai.map((a) => (
          <div key={a.id} className="qcard" data-testid={`ai-${a.id}`}>
            <div>
              {a.status === "approved" ? <a href={`/e/${a.id}`}><b>{a.title}</b></a> : <b>{a.title}</b>}
              <div className="meta">{a.status === "approved" ? "Approved" : "Rejected"} · {a.review_note || "No reason given"}</div>
            </div>
            <div className="qactions">
              {a.status === "approved"
                ? <button type="button" className="btn danger" onClick={async () => done(await post(`/api/admin/events/${a.id}`, { action: "reject", reason: "Removed by admin" }))}>Remove</button>
                : <button type="button" className="btn" onClick={async () => done(await post(`/api/admin/events/${a.id}`, { action: "restore" }))}>Approve anyway</button>}
            </div>
          </div>
        ))}
      </section>

      {p.noLocation.length > 0 && (
        <section>
          <h2>Location not found</h2>
          <p className="hint">These are live, but won&apos;t show in &ldquo;near me&rdquo; until the address is fixed.</p>
          {p.noLocation.map((e) => <div key={e.id} className="qcard"><div><a href={`/e/${e.id}`}><b>{e.title}</b></a><div className="meta">{e.address || "No address"}</div></div></div>)}
        </section>
      )}

      <section>
        <h2>Cities</h2>
        <p className="hint">{p.cities.map((c) => c.name).join(" · ") || "None yet."}</p>
        <CityForm done={done} />
      </section>

      <button type="button" className="link" onClick={async () => { await post("/api/admin/logout", {}); window.location.reload(); }}>Sign out</button>
    </div>
  );
}

function QueueCard({ q, cities, done }: { q: QueueItem; cities: City[]; done: (m: string | null) => void }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ title: q.title, start_local: q.start_local, venue_name: q.venue_name ?? "", address: q.address ?? "", city_id: q.city_id, category: q.category });
  const when = new Intl.DateTimeFormat("en-US", { timeZone: q.tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(q.start_utc));
  const fields = { ...f, venue_name: f.venue_name || null, address: f.address || null };
  return (
    <article className="qcard" data-testid={`q-${q.id}`}>
      <div className="qmain">
        {q.image_path && <img src={`/flyers/${q.image_path}`} alt="" />}
        <div>
          <b>{q.title}</b>
          <div className="meta">{when} · {[q.venue_name, q.address].filter(Boolean).join(", ") || "No place given"}</div>
          <div className="meta">{CATS.find((c) => c[0] === q.category)?.[1]}{q.price_min === 0 ? " · Free" : q.price_min != null ? ` · $${q.price_min}` : ""}{q.city_name ? ` · ${q.city_name}` : ""}</div>
          {q.new_city && !q.city_id && <div className="flag">New city: {q.new_city}. Pick a city below or add one first.</div>}
          {q.review_note && <div className="flag">AI: {q.review_note}</div>}
          {q.source_url && <a className="meta" href={q.source_url} target="_blank" rel="noopener noreferrer nofollow">Open the original page</a>}
          {q.submitter_email && <div className="meta">From {q.submitter_email}</div>}
          {q.description && <p className="qdesc">{q.description}</p>}
        </div>
      </div>
      {edit && (
        <div className="sheet-body qedit">
          <label>Event name<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label>Date and time<input type="datetime-local" value={f.start_local} onChange={(e) => setF({ ...f, start_local: e.target.value })} /></label>
          <label>Venue<input value={f.venue_name} onChange={(e) => setF({ ...f, venue_name: e.target.value })} /></label>
          <label>Address<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
          <label>City
            <select value={f.city_id ?? ""} onChange={(e) => setF({ ...f, city_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No city yet</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Kind
            <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>
          </label>
        </div>
      )}
      <div className="qactions">
        <button type="button" className="btn pink" onClick={async () => done(await post(`/api/admin/events/${q.id}`, edit ? { action: "approve", fields } : { action: "approve" }))}>{edit ? "Save and approve" : "Approve"}</button>
        {edit
          ? <button type="button" className="btn" onClick={async () => done(await post(`/api/admin/events/${q.id}`, { action: "update", fields }))}>Save only</button>
          : <button type="button" className="btn" onClick={() => setEdit(true)}>Edit</button>}
        <button type="button" className="btn danger" onClick={async () => done(await post(`/api/admin/events/${q.id}`, { action: "reject" }))}>Reject</button>
      </div>
    </article>
  );
}

function CityForm({ done }: { done: (m: string | null) => void }) {
  const [name, setName] = useState("");
  const [tz, setTz] = useState("America/Los_Angeles");
  return (
    <form className="sheet-body cityform" onSubmit={async (e) => { e.preventDefault(); done(await post("/api/admin/cities", { name, tz })); }}>
      <div className="row2">
        <label>City name<input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Atlanta" /></label>
        <label>Time zone
          <select value={tz} onChange={(e) => setTz(e.target.value)}>
            {["America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "Europe/London", "Africa/Lagos", "Africa/Nairobi", "Africa/Johannesburg"].map((z) => <option key={z}>{z}</option>)}
          </select>
        </label>
      </div>
      <button type="submit" className="btn">Add city</button>
    </form>
  );
}
