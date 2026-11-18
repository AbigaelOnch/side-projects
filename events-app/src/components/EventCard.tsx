import { Poster } from "./Poster";
import { categoryLabel } from "@/lib/config";

export type CardData = {
  id: number; title: string; venue_name: string | null; image_path: string | null;
  category: string; price: string | null; singles_friendly: number; go_solo: number; series_rule: string | null;
  distance_mi?: number | null; time: string; day_key: string; day_label: string; day_sub: string;
};

export function EventCard({ e }: { e: CardData }) {
  const meta = [e.venue_name, e.distance_mi != null ? `${e.distance_mi.toFixed(1)} mi` : null, e.price].filter(Boolean).join(" · ");
  return (
    <a className={`card${e.image_path ? "" : " noimg"}`} href={`/e/${e.id}`}>
      <div className="media">
        {e.image_path ? <img className="flyer" src={`/flyers/${e.image_path}`} alt="" loading="lazy" /> : <Poster id={e.id} />}
        <span className="when">{e.time}</span>
      </div>
      <div className="scrim">
        <h3>{e.title}</h3>
        {meta && <div className="meta">{meta}</div>}
        <div className="tags">
          <span className="tag">{categoryLabel(e.category)}</span>
          {e.series_rule ? <span className="tag">{e.series_rule}</span> : null}
          {e.go_solo ? <span className="tag">Good to go solo</span> : null}
          {e.singles_friendly && e.category !== "dating" ? <span className="tag">Singles-friendly</span> : null}
        </div>
      </div>
    </a>
  );
}
