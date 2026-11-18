// Quiet, tonal artwork for events that have no flyer image. Deterministic per event, in the app palette:
// a deep brown field, two soft tonal shapes, and one small accent (orange or amber).
const PALETTES = [
  { bg: "#2A1D18", t1: "#3A2921", t2: "#4E382D", accent: "#FF7A45" },
  { bg: "#241A16", t1: "#352720", t2: "#48362B", accent: "#F2B84B" },
  { bg: "#2E1E17", t1: "#412B20", t2: "#573A2B", accent: "#FF7A45" },
  { bg: "#221914", t1: "#32261E", t2: "#453529", accent: "#F2B84B" },
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
