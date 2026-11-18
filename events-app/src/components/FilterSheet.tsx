"use client";
import { useRef, useState } from "react";

const CATS = [["networking", "Networking"], ["career", "Career & tech"], ["social", "Social & culture"], ["wellness", "Wellness"]] as const;
const RADII = [5, 10, 25, 50];
const FORMATS = [["speed", "Speed dating"], ["mixer", "Singles mixer"], ["activity", "Activity"], ["social", "Social"]] as const;
const AGES = [["20s", "20s"], ["30s", "30s"], ["40plus", "40+"]] as const;

/** One Filters button that opens a bottom sheet: category, distance, free, dating. */
export function FilterSheet(p: { cats: string[]; free: boolean; dating: boolean; radius: number | null; singles: boolean; solo: boolean; formats: string[]; ages: string[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [cats, setCats] = useState(p.cats);
  const [free, setFree] = useState(p.free);
  const [dating, setDating] = useState(p.dating);
  const [radius, setRadius] = useState(p.radius);
  const [singles, setSingles] = useState(p.singles);
  const [solo, setSolo] = useState(p.solo);
  const [formats, setFormats] = useState(p.formats);
  const [ages, setAges] = useState(p.ages);
  const flip = (set: typeof setFormats) => (id: string) => set((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const count = p.cats.length + (p.free ? 1 : 0) + (p.dating ? 1 : 0) + (p.radius != null && p.radius !== 25 ? 1 : 0)
    + (p.singles ? 1 : 0) + (p.solo ? 1 : 0) + p.formats.length + p.ages.length;
  const toggle = (id: string) => setCats((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  function apply() {
    const q = new URLSearchParams(window.location.search);
    q.delete("cursor");
    const chosen = cats.filter((c) => c !== "dating" || dating);
    if (chosen.length) q.set("cat", chosen.join(",")); else q.delete("cat");
    if (free) q.set("free", "1"); else q.delete("free");
    if (dating) q.set("dating", "1"); else q.delete("dating");
    if (radius != null && q.has("near")) q.set("r", String(radius));
    if (singles) q.set("sf", "1"); else q.delete("sf");
    if (solo) q.set("solo", "1"); else q.delete("solo");
    if (dating && formats.length) q.set("fmt", formats.join(",")); else q.delete("fmt");
    if (ages.length) q.set("age", ages.join(",")); else q.delete("age");
    const url = `/?${q.toString()}`;
    window.location.assign(dating !== p.dating ? `/prefs/dating?on=${dating ? "1" : "0"}&next=${encodeURIComponent(url)}` : url);
  }
  function clear() { setCats([]); setFree(false); setRadius(p.radius != null ? 25 : null); setSingles(false); setSolo(false); setFormats([]); setAges([]); }

  return (
    <>
      <button type="button" className="filters" onClick={() => ref.current?.showModal()} aria-haspopup="dialog">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
        Filters{count ? <span className="count">{count}</span> : null}
      </button>
      <dialog ref={ref} className="sheet" aria-label="Filters" onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
        <div className="sheet-in">
          <div className="sheet-top"><h2>Filters</h2><button type="button" className="link" onClick={clear}>Clear</button></div>
          <fieldset><legend>Kind of event</legend>
            <div className="chips wrapchips">
              {CATS.map(([id, label]) => <button key={id} type="button" className="chip" aria-pressed={cats.includes(id)} onClick={() => toggle(id)}>{label}</button>)}
              {dating && <button type="button" className="chip" aria-pressed={cats.includes("dating")} onClick={() => toggle("dating")}>Dating</button>}
            </div>
          </fieldset>
          {radius != null && (
            <fieldset><legend>Distance</legend>
              <div className="chips wrapchips radius">
                {RADII.map((r) => <button key={r} type="button" className="chip" aria-pressed={radius === r} onClick={() => setRadius(r)}>{r} mi</button>)}
              </div>
            </fieldset>
          )}
          <fieldset><legend>Meeting people</legend>
            <div className="chips wrapchips">
              <button type="button" className="chip" aria-pressed={solo} onClick={() => setSolo(!solo)}>Good to go solo</button>
              <button type="button" className="chip" aria-pressed={singles} onClick={() => setSingles(!singles)}>Singles-friendly</button>
            </div>
          </fieldset>
          {dating && (
            <fieldset><legend>Dating events</legend>
              <div className="chips wrapchips">
                {FORMATS.map(([id, label]) => <button key={id} type="button" className="chip" aria-pressed={formats.includes(id)} onClick={() => flip(setFormats)(id)}>{label}</button>)}
              </div>
              <div className="chips wrapchips" style={{ marginTop: 8 }}>
                {AGES.map(([id, label]) => <button key={id} type="button" className="chip" aria-pressed={ages.includes(id)} onClick={() => flip(setAges)(id)}>{label}</button>)}
              </div>
            </fieldset>
          )}
          <fieldset><legend>More</legend>
            <label className="switch"><input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} /> Free events only</label>
            <label className="switch"><input type="checkbox" checked={dating} onChange={(e) => setDating(e.target.checked)} /> Show dating events</label>
          </fieldset>
          <button type="button" className="btn pink wide" onClick={apply}>Show events</button>
        </div>
      </dialog>
    </>
  );
}
