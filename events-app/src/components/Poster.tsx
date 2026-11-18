// Poster-style artwork for events that have no flyer image. Deterministic per event, in the B palette.
const PALETTES = [
  { bg: "#5A1E73", a: "#FF5C8A", b: "#F5C451", text: "#F6EEF9" },
  { bg: "#F5C451", a: "#FF5C8A", b: "#5A1E73", text: "#1A0E24" },
  { bg: "#2E1C3D", a: "#F5C451", b: "#FF5C8A", text: "#F6EEF9" },
  { bg: "#FF5C8A", a: "#5A1E73", b: "#F5C451", text: "#1A0E24" },
  { bg: "#3B1450", a: "#7A3FD1", b: "#F5C451", text: "#F6EEF9" },
];

function hash(n: number) {
  let x = (n * 2654435761) >>> 0;
  return () => ((x = (x * 1103515245 + 12345) >>> 0) % 1000) / 1000;
}

export function Poster({ id, title }: { id: number; title: string }) {
  const r = hash(id);
  const p = PALETTES[id % PALETTES.length];
  const words = posterWords(title);
  const s1 = 180 + Math.round(r() * 140);
  const s2 = 110 + Math.round(r() * 90);
  return (
    <div className="art" aria-hidden="true" style={{ background: p.bg }}>
      <i style={{ width: s1, height: s1, background: p.a, left: `${-25 + r() * 30}%`, top: `${48 + r() * 15}%` }} />
      <i style={{ width: s2, height: s2, background: p.b, right: `${-28 + r() * 10}%`, top: `${-14 + r() * 8}%` }} />
      <div className="word" style={{ color: p.text, fontSize: `min(54px, ${(76 / Math.max(5, longest(words))).toFixed(1)}cqw)` }}>{words}</div>
    </div>
  );
}

const STOP = new Set(["for", "&", "and", "the", "of", "a", "with", "to", "at", "in", "on"]);
/** Up to 3 words for the poster, never ending on a connector ("for", "&"...). */
export function posterWords(title: string): string {
  const w = title.replace(/\(.*?\)/g, "").replace(/:.*$/, "").split(/\s+/).filter(Boolean);
  let out = w.slice(0, 3);
  while (out.length > 1 && STOP.has(out[out.length - 1].toLowerCase())) out = out.slice(0, -1);
  return out.join(" ");
}

const longest = (s: string) => Math.max(...s.split(/\s+/).map((w) => w.length));
