import { notFound } from "next/navigation";
import { getEvent, priceLabel } from "@/lib/events";
import { categoryLabel } from "@/lib/config";
import { fmtDay, fmtLongDate, fmtTime, fmtTzName } from "@/lib/time";
import { Poster } from "@/components/Poster";
import { Report } from "@/components/Report";
import { BackIcon, CalIcon, ClockIcon, PersonIcon, PinIcon, PlusIcon, TicketIcon } from "@/components/Icons";

export const dynamic = "force-dynamic";

const PLATFORM: Record<string, string> = {
  eventbrite: "Eventbrite", luma: "Luma", partiful: "Partiful", posh: "Posh", meetup: "Meetup", instagram: "Instagram", tiktok: "TikTok",
};

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const e = getEvent(Number(id));
  if (!e) notFound();
  const tzName = fmtTzName(e.start_utc, e.tz);
  const time = `${fmtTime(e.start_utc, e.tz)}${e.end_utc ? `–${fmtTime(e.end_utc, e.tz)}` : ""} ${tzName}`;
  const price = priceLabel(e);
  const place = [e.venue_name, e.address].filter(Boolean).join(", ") || (e.online ? "Online" : e.city_name ?? "");

  return (
    <>
      <main className="event">
        <div>
          <a className="back" href="/"><BackIcon /> All events</a>
          <div className="hero-art" style={{ marginTop: 6 }}>
            {e.image_path ? <img src={`/flyers/${e.image_path}`} alt={`Flyer for ${e.title}`} /> : <Poster id={e.id} title={e.title} />}
          </div>
        </div>
        <div>
          <div className="tags" style={{ marginTop: 0, marginBottom: 12 }}>
            <span className="tag">{categoryLabel(e.category)}</span>
            {e.go_solo ? <span className="tag gold">Good to go solo</span> : null}
            {e.singles_friendly && e.category !== "dating" ? <span className="tag pink">Singles-friendly</span> : null}
          </div>
          <h1>{e.title}</h1>

          <div className="facts">
            <div className="fact"><ClockIcon /><div>
              <b>{e.series_rule ? `${e.series_rule} · next ${fmtDay(e.start_utc, e.tz)}` : fmtLongDate(e.start_utc, e.tz)}</b>
              <span>{time}</span>
            </div></div>
            {place && <div className="fact"><PinIcon c="#F5C451" /><div><b>{e.venue_name || place}</b>{e.venue_name && e.address ? <span>{e.address}</span> : null}</div></div>}
            {price && <div className="fact"><TicketIcon /><div><b>{price}</b></div></div>}
            {e.organiser && <div className="fact"><PersonIcon /><div><b>Hosted by {e.organiser}</b></div></div>}
          </div>

          <div className="actions">
            {e.sources.map((s, i) => (
              <a key={s.url} className={`btn ${i === 0 ? "pink" : ""}`} href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                {i === 0 ? "Get tickets / RSVP" : "Also on"}{s.platform && PLATFORM[s.platform] ? ` on ${PLATFORM[s.platform]}` : ""}
              </a>
            ))}
            <a className="btn" href={`/e/${e.id}/ics`}><CalIcon /> Add to calendar</a>
          </div>

          {e.nextDates.length > 1 && (
            <div className="note" style={{ marginBottom: 16 }}>
              <b style={{ color: "var(--ink)" }}>Next dates:</b> {e.nextDates.map((d) => fmtDay(d, e.tz)).join(" · ")}
            </div>
          )}
          {e.description && <div className="desc">{e.description}</div>}
          {e.category === "dating" && (
            <div className="note" style={{ marginTop: 16 }}>Meeting new people? Meet in public, tell a friend where you&apos;ll be, and arrange your own ride.</div>
          )}
          <div style={{ marginTop: 14 }}><Report eventId={e.id} /></div>
        </div>
      </main>
      <a className="fab" href="/share"><PlusIcon /> Share an event</a>
    </>
  );
}
