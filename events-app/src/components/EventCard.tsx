import { Poster } from "./Poster";
import { categoryLabel } from "@/lib/config";
import { fmtDay, fmtTime } from "@/lib/time";

export type CardData = {
  id: number; title: string; start_utc: string; tz: string; venue_name: string | null; image_path: string | null;
  category: string; price: string | null; singles_friendly: number; go_solo: number; series_rule: string | null;
  distance_mi?: number | null;
};

export function EventCard({ e, now }: { e: CardData; now?: Date }) {
  const when = e.series_rule ? `${e.series_rule} · next ${fmtDay(e.start_utc, e.tz, now)}` : `${fmtDay(e.start_utc, e.tz, now)} · ${fmtTime(e.start_utc, e.tz)}`;
  const meta = [e.venue_name, e.distance_mi != null ? `${e.distance_mi.toFixed(1)} mi` : null, e.price].filter(Boolean).join(" · ");
  return (
    <a className={`card${e.image_path ? "" : " noimg"}`} href={`/e/${e.id}`}>
      <div className="media">
        {e.image_path ? <img className="flyer" src={`/flyers/${e.image_path}`} alt="" loading="lazy" /> : <Poster id={e.id} title={e.title} />}
        <span className="when">{when}</span>
      </div>
      <div className="scrim">
        <h2>{e.title}</h2>
        {meta && <div className="meta">{meta}</div>}
        <div className="tags">
          <span className="tag">{categoryLabel(e.category)}</span>
          {e.go_solo ? <span className="tag gold">Good to go solo</span> : null}
          {e.singles_friendly && e.category !== "dating" ? <span className="tag pink">Singles-friendly</span> : null}
        </div>
      </div>
    </a>
  );
}
