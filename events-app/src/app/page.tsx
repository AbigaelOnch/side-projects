import { cookies } from "next/headers";
import { APP_NAME, TABS } from "@/lib/config";
import { listCities } from "@/lib/events";
import { featured, feedPage, feedQuery, justAdded, type FeedParams } from "@/lib/feed";
import { Poster } from "@/components/Poster";
import { Feed } from "@/components/Feed";
import { FilterSheet } from "@/components/FilterSheet";
import { PinIcon, PlusIcon } from "@/components/Icons";
import { AutoNear, NearMeButton } from "@/components/NearMe";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<FeedParams & { pick?: string }> }) {
  const sp = await searchParams;
  const jar = await cookies();
  const cookieCity = jar.get("city")?.value;
  const noPlace = !sp.city && !sp.near && sp.pick !== "1";
  if (noPlace && jar.get("near")?.value === "1") {
    return (
      <main className="wrap">
        <header className="top"><a className="brand" href="/">{APP_NAME}</a></header>
        <AutoNear radius={25} fallback={cookieCity ? `/?city=${encodeURIComponent(cookieCity)}` : "/?pick=1"} />
      </main>
    );
  }
  const f = feedPage(sp, cookieCity, jar.get("dating")?.value);
  if (!f.city || sp.pick === "1") return <CityPicker />;

  const city = f.city;
  const base = { city: city.slug, near: f.near, tab: f.tab, cats: f.cats, free: f.free, dating: f.dating, singles: f.singles, solo: f.solo, formats: f.formats, ages: f.ages };
  const href = (o: Partial<typeof base>) => `/?${feedQuery({ ...base, ...o })}`;
  const where = f.near ? `within ${f.near.radius} miles` : `in ${city.name}`;
  const tabLabel = f.tab === "all" ? "" : TABS.find((t) => t.id === f.tab)!.label.toLowerCase();
  const filtered = f.cats.length > 0 || f.free || f.singles || f.solo || f.formats.length > 0 || f.ages.length > 0;
  const shelf = filtered ? [] : featured(f);
  const fresh = filtered ? [] : justAdded(f);

  return (
    <>
      <main className="wrap">
        <header className="top">
          <a className="brand" href="/">{APP_NAME}</a>
          <a className="loc" href="/?pick=1" aria-label={`Location: ${f.near ? "near you" : city.name}. Change location`}>
            <PinIcon c="currentColor" /> {f.near ? "Near you" : city.name}
          </a>
        </header>

        {fresh.length > 0 && (
          <section className="shelf" aria-label="Just added">
            <h2>Just added</h2>
            <div className="shelf-row">
              {fresh.map((e) => (
                <a key={e.id} href={`/e/${e.id}`} className="pick-card">
                  {e.image_path ? <img src={`/flyers/${e.image_path}`} alt="" /> : <span className="pick-art"><Poster id={e.id} /></span>}
                  <b>{e.title}</b>
                  <span>{e.day_label}{e.day_sub && e.day_label !== "Today" && e.day_label !== "Tomorrow" ? `, ${e.day_sub}` : ""} · {e.time}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {shelf.length > 0 && (
          <section className="shelf" aria-label="Coming up">
            <h2>Coming up {f.near ? "near you" : `in ${city.name}`}</h2>
            <div className="shelf-row">
              {shelf.map((e) => (
                <a key={e.id} href={`/e/${e.id}`} className="pick-card">
                  <img src={`/flyers/${e.image_path}`} alt="" />
                  <b>{e.title}</b>
                  <span>{e.day_label} · {e.time}</span>
                </a>
              ))}
            </div>
          </section>
        )}

        <div className="controls">
          <nav className="tabs" aria-label="When">
            {TABS.map((t) => (
              <a key={t.id} className="tab" href={href({ tab: t.id })} aria-current={t.id === f.tab ? "page" : undefined}>{t.label}</a>
            ))}
          </nav>
          <FilterSheet key={href({})} cats={f.cats} free={f.free} dating={f.dating} radius={f.near?.radius ?? null}
            singles={f.singles} solo={f.solo} formats={f.formats} ages={f.ages} />
        </div>

        {f.events.length === 0 ? (
          <section className="empty">
            <h2>Nothing listed {tabLabel === "tonight" ? "for tonight" : tabLabel} {where} yet</h2>
            <p style={{ color: "var(--soft)", margin: "0 0 16px" }}>
              {filtered ? "Try fewer filters or a longer time range. " : "Try a longer time range. "}
              Know about something good? Share it and we&apos;ll add it.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {f.tab !== "all" && <a className="btn" href={href({ tab: "all" })}>See all upcoming</a>}
              {f.near && f.near.radius < 50 && <a className="btn" href={href({ near: { ...f.near, radius: 50 } })}>Look within 50 miles</a>}
              <a className="btn pink" href="/share">Share an event</a>
            </div>
          </section>
        ) : (
          <Feed key={href({})} initial={f.events} initialNext={f.next} query={feedQuery(base)} />
        )}
      </main>
      <a className="fab" href="/share"><PlusIcon /> Share an event</a>
    </>
  );
}

function CityPicker() {
  const cities = listCities();
  return (
    <main className="wrap">
      <header className="top"><a className="brand" href="/">{APP_NAME}</a></header>
      <section className="pick">
        <h1>Find events near you</h1>
        {cities.length === 0 ? (
          <div className="note">No cities have been set up yet. If you run this site, add a city in the admin area to get started.</div>
        ) : (
          <>
            <p>Events for the African diaspora, near you.</p>
            <NearMeButton />
            <h2 className="or">Or pick a city</h2>
            <div className="cities">
              {cities.map((c) => <a key={c.id} href={`/city/${c.slug}`}>{c.name} <span aria-hidden="true">→</span></a>)}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
