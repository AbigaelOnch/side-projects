"use client";
import { useEffect, useRef, useState } from "react";

type Draft = {
  title?: string; start_local?: string; end_local?: string | null; utc_offset_min?: number | null; venue_name?: string | null;
  address?: string | null; city?: string | null; online?: boolean; price_min?: number | null; price_text?: string | null;
  organiser?: string | null; description?: string | null; category?: string | null; singles_friendly?: boolean; go_solo?: boolean;
  dating_format?: string | null; age_range?: string | null;
};
type Read =
  | { status: "ok"; draft: Draft; image: string | null; source: string | null; platform: string | null; note?: string }
  | { status: "already"; eventId: number; title: string; live?: boolean }
  | { status: "need_screenshot" | "not_event" | "unreachable" | "error"; message: string; source?: string };

const CATS = [
  ["networking", "Networking"], ["career", "Career & tech"], ["social", "Social & culture"], ["wellness", "Wellness"], ["dating", "Dating"],
] as const;
const FORMATS = [["speed", "Speed dating"], ["mixer", "Singles mixer"], ["activity", "Activity"], ["social", "Social"]] as const;

type Step = { s: "start" } | { s: "reading"; what: string } | { s: "problem"; message: string; source?: string }
  | { s: "already"; eventId: number; title: string; live?: boolean } | { s: "form" } | { s: "sending" }
  | { s: "done"; newCity: string | null };

export function ShareSheet({ initial }: { initial: string }) {
  const [link, setLink] = useState(initial);
  const [step, setStep] = useState<Step>({ s: "start" });
  const [d, setD] = useState<Draft>({});
  const [image, setImage] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [hp, setHp] = useState("");
  const [canPaste, setCanPaste] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  useEffect(() => { setCanPaste(typeof navigator !== "undefined" && !!navigator.clipboard?.readText); }, []);
  useEffect(() => {
    if (initial && !started.current) { started.current = true; void readLink(initial); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  function apply(r: Read) {
    if (r.status === "ok") {
      setD(r.draft || {}); setImage(r.image); setSource(r.source ?? source); setNote(r.note ?? null);
      setMissing(required(r.draft || {})); setStep({ s: "form" });
    } else if (r.status === "already") setStep({ s: "already", eventId: r.eventId, title: r.title, live: r.live });
    else setStep({ s: "problem", message: r.message, source: r.source });
    if ("source" in r && r.source) setSource(r.source);
  }

  async function readLink(v: string) {
    if (!v.trim()) return;
    setStep({ s: "reading", what: "Reading the event…" });
    try {
      const r = await fetch("/api/submit/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: v }) });
      apply((await r.json()) as Read);
    } catch {
      setStep({ s: "problem", message: "You seem to be offline. Check your connection and try again." });
    }
  }

  async function readFlyer(file: File) {
    if (file.size > 10 * 1024 * 1024) return setStep({ s: "problem", message: "That image is over 10 MB. Try a screenshot instead." });
    setStep({ s: "reading", what: "Reading the flyer…" });
    const fd = new FormData();
    fd.append("flyer", file);
    if (source) fd.append("source", source);
    try {
      const r = await fetch("/api/submit/flyer", { method: "POST", body: fd });
      apply((await r.json()) as Read);
    } catch {
      setStep({ s: "problem", message: "You seem to be offline. Check your connection and try again." });
    }
  }

  async function paste() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) { setLink(t); void readLink(t); }
    } catch { /* the user said no; typing or long-press paste still works (S-087) */ }
  }

  async function send() {
    const miss = required(d);
    setMissing(miss);
    if (miss.length) return;
    setStep({ s: "sending" });
    try {
      const r = await fetch("/api/submit", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...clean(d), image, source, email: email || null, website: hp }),
      });
      const j = await r.json();
      if (j.status === "queued") setStep({ s: "done", newCity: j.newCity });
      else if (j.status === "already") setStep({ s: "already", eventId: j.eventId, title: j.title, live: j.live });
      else { setNote(j.message); setMissing(j.fields ?? []); setStep({ s: "form" }); }
    } catch {
      setNote("You seem to be offline. Your details are still here; try again in a moment.");
      setStep({ s: "form" });
    }
  }

  const reset = () => { setLink(""); setD({}); setImage(null); setSource(null); setNote(null); setMissing([]); setStep({ s: "start" }); };
  const flyerInput = (
    <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label="Choose a flyer image"
      onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFlyer(f); e.target.value = ""; }} />
  );
  const flyerButton = (label: string) => (
    <button type="button" className="btn ghost wide" onClick={() => fileRef.current?.click()}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-9 8" /></svg>
      {label}
    </button>
  );

  if (step.s === "done") return (
    <div className="sheet-body" role="status">
      <h2>Thanks, it&apos;s in!</h2>
      <p className="lede">It&apos;ll show up once it&apos;s been checked{step.newCity ? `. We don't cover ${step.newCity} yet, so we'll look at adding it` : ""}.</p>
      <div className="stack">
        <button type="button" className="btn pink wide" onClick={reset}>Share another event</button>
        <a className="btn wide" href="/">Back to events</a>
      </div>
    </div>
  );

  if (step.s === "already") return (
    <div className="sheet-body" role="status">
      <h2>Already listed</h2>
      <p className="lede">“{step.title}” {step.live === false ? "has already been shared and is being checked" : "is already on Afro Social"}, so there&apos;s nothing more to add. Thanks for sending it.</p>
      <div className="stack">
        {step.live !== false && <a className="btn pink wide" href={`/e/${step.eventId}`}>See the event</a>}
        <button type="button" className="btn wide" onClick={reset}>Share a different event</button>
      </div>
    </div>
  );

  if (step.s === "form" || step.s === "sending") {
    const bad = (k: string) => missing.includes(k);
    const set = (k: keyof Draft, v: unknown) => { setD((x) => ({ ...x, [k]: v })); setMissing((m) => m.filter((y) => y !== k && !(k === "start_local" && y === "time"))); };
    const date = d.start_local?.slice(0, 10) ?? "";
    const time = d.start_local?.slice(11, 16) ?? "";
    const endTime = d.end_local?.slice(11, 16) ?? "";
    return (
      <form className="sheet-body" onSubmit={(e) => { e.preventDefault(); void send(); }} noValidate>
        {image || d.title ? (
          <div className="preview">
            {image ? <img src={`/flyers/${image}`} alt="" /> : <div className="preview-art" aria-hidden="true" />}
            <div>
              <div className="ok-note">We filled this in. Fix anything that&apos;s off.</div>
              <div className="preview-title">{d.title || "Untitled event"}</div>
            </div>
          </div>
        ) : <p className="lede">Add the details below.</p>}
        {note && <p className="warn" role="alert">{note}</p>}

        <label className={bad("title") ? "bad" : ""}>Event name
          <input value={d.title ?? ""} onChange={(e) => set("title", e.target.value)} maxLength={160} required />
        </label>
        <div className="row2">
          <label className={bad("start_local") ? "bad" : ""}>Date
            <input type="date" value={date} onChange={(e) => set("start_local", `${e.target.value}T${time || "19:00"}`)} required />
          </label>
          <label className={bad("time") ? "bad" : ""}>Starts
            <input type="time" value={time} onChange={(e) => set("start_local", `${date || new Date().toISOString().slice(0, 10)}T${e.target.value}`)} required />
          </label>
        </div>
        <label>Ends <span className="opt">(optional)</span>
          <input type="time" value={endTime} onChange={(e) => set("end_local", e.target.value && date ? `${date}T${e.target.value}` : null)} />
        </label>
        <label>Venue
          <input value={d.venue_name ?? ""} onChange={(e) => set("venue_name", e.target.value)} maxLength={160} placeholder="e.g. The Hive" />
        </label>
        <label className={bad("city") ? "bad" : ""}>Address or city
          <input value={d.address ?? d.city ?? ""} onChange={(e) => { set("address", e.target.value); set("city", null); }} maxLength={300} placeholder="e.g. 2101 Broadway, Oakland" />
        </label>
        <fieldset className={bad("category") ? "bad" : ""}>
          <legend>What kind of event?</legend>
          <div className="chips wrapchips">
            {CATS.map(([id, label]) => (
              <button key={id} type="button" className="chip" aria-pressed={d.category === id} onClick={() => set("category", id)}>{label}</button>
            ))}
          </div>
        </fieldset>
        {d.category === "dating" && (
          <fieldset>
            <legend>Dating details <span className="opt">(optional)</span></legend>
            <div className="chips wrapchips">
              {FORMATS.map(([id, label]) => (
                <button key={id} type="button" className="chip" aria-pressed={d.dating_format === id}
                  onClick={() => set("dating_format", d.dating_format === id ? null : id)}>{label}</button>
              ))}
            </div>
            <label>Age range
              <input value={d.age_range ?? ""} onChange={(e) => set("age_range", e.target.value)} maxLength={20} placeholder="e.g. 30s or 25–40" />
            </label>
          </fieldset>
        )}
        <div className="chips wrapchips">
          <button type="button" className="chip" aria-pressed={!!d.go_solo} onClick={() => set("go_solo", !d.go_solo)}>Good to go solo</button>
          {d.category !== "dating" && <button type="button" className="chip" aria-pressed={!!d.singles_friendly} onClick={() => set("singles_friendly", !d.singles_friendly)}>Singles-friendly</button>}
          <button type="button" className="chip" aria-pressed={d.price_min === 0} onClick={() => set("price_min", d.price_min === 0 ? null : 0)}>Free</button>
        </div>
        {d.price_min !== 0 && (
          <label>Price <span className="opt">(optional)</span>
            <input inputMode="decimal" value={d.price_min ?? ""} onChange={(e) => set("price_min", e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0))} placeholder="e.g. 20" />
          </label>
        )}
        <label>Host <span className="opt">(optional)</span>
          <input value={d.organiser ?? ""} onChange={(e) => set("organiser", e.target.value)} maxLength={160} />
        </label>
        <label>About it <span className="opt">(optional)</span>
          <textarea value={d.description ?? ""} onChange={(e) => set("description", e.target.value)} maxLength={2000} rows={3} />
        </label>
        <label>Your email <span className="opt">(optional, to hear when it&apos;s live)</span>
          <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} placeholder="you@example.com" />
        </label>
        <label className="hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} /></label>
        {missing.length > 0 && <p className="warn" role="alert">Please fill in the highlighted details.</p>}
        <div className="sticky-actions">
          <button type="submit" className="btn pink wide" disabled={step.s === "sending"}>{step.s === "sending" ? "Sending…" : "Looks good — submit"}</button>
          <p className="fine">No account needed. It shows up once it&apos;s been checked.</p>
        </div>
        {flyerInput}
      </form>
    );
  }

  return (
    <div className="sheet-body">
      <form className="sheet-body" onSubmit={(e) => { e.preventDefault(); void readLink(link); }}>
        <label htmlFor="link">Paste an event link or Instagram post</label>
        <div className="field">
          <input id="link" type="url" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false}
            value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a link here" />
          <button type="button" className="inbtn" aria-label="Add a flyer screenshot instead" onClick={() => fileRef.current?.click()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-9 8" /></svg>
          </button>
        </div>
        {link.trim() || !canPaste
          ? <button type="submit" className="btn pink wide" disabled={!link.trim() || step.s === "reading"}>Find the event</button>
          : <button type="button" className="btn pink wide" onClick={paste}>Paste link</button>}
      </form>

      {step.s === "reading" && <p className="lede busy" role="status"><span className="dot" /> {step.what}</p>}
      {step.s === "problem" && <p className="warn" role="alert">{step.message}</p>}
      {step.s === "problem" && flyerButton("Add a flyer screenshot")}
      {step.s === "problem" && <button type="button" className="btn wide" onClick={() => { setD({}); setMissing([]); setStep({ s: "form" }); }}>Fill it in myself</button>}
      <p className="fine">Works with Eventbrite, Luma, Partiful, Posh, Meetup, Instagram and TikTok links, or a flyer screenshot. No account needed.</p>
      {flyerInput}
    </div>
  );
}

function required(d: Draft): string[] {
  const m: string[] = [];
  if (!d.title || d.title.trim().length < 2) m.push("title");
  if (!d.start_local || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(d.start_local)) m.push("start_local", "time");
  if (!d.category) m.push("category");
  if (!d.online && !(d.address || d.city || d.venue_name)) m.push("city");
  return m;
}

function clean(d: Draft): Draft {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) if (v !== "" && v !== undefined) out[k] = typeof v === "string" ? v.trim() : v;
  return out as Draft;
}
