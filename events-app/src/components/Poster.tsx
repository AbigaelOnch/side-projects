// Quiet, tonal artwork for events that have no flyer image. Deterministic per event, in the app palette:
// a deep plum field, two soft tonal shapes, and one small accent (pink or gold).
const PALETTES = [
  { bg: "#2A1638", t1: "#3A1E4E", t2: "#4A2862", accent: "#FF5C8A" },
  { bg: "#251433", t1: "#36204A", t2: "#46295E", accent: "#F5C451" },
  { bg: "#2E1530", t1: "#432040", t2: "#5A2A52", accent: "#FF5C8A" },
  { bg: "#1F1430", t1: "#2E2048", t2: "#3C2A5E", accent: "#F5C451" },
];

function rand(n: number) {
  let x = (n * 2654435761) >>> 0;
  return () => ((x = (x * 1103515245 + 12345) >>> 0) % 1000) / 1000;
}

export function Poster({ id }: { id: number; title?: string }) {
  const r = rand(id);
  const p = PALETTES[id % PALETTES.length];
  const big = 70 + r() * 30; // % of width
  const ring = 34 + r() * 18;
  const dot = 7 + r() * 5;
  return (
    <div className="art" aria-hidden="true" style={{ background: p.bg }}>
      <i style={{ width: `${big}%`, aspectRatio: "1", background: p.t1, right: `${-big / 3}%`, top: `${8 + r() * 14}%` }} />
      <i style={{ width: `${ring}%`, aspectRatio: "1", border: `1.5px solid ${p.t2}`, left: `${6 + r() * 12}%`, top: `${14 + r() * 10}%` }} />
      <i style={{ width: `${dot}%`, aspectRatio: "1", background: p.accent, left: `${18 + r() * 50}%`, top: `${22 + r() * 18}%` }} />
    </div>
  );
}
