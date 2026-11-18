import { cookies } from "next/headers";
import { APP_NAME, CATEGORIES, TABS } from "@/lib/config";
import { listCities } from "@/lib/events";
import { feedPage, feedQuery, type FeedParams } from "@/lib/feed";
import { EventCard } from "@/components/EventCard";
import { LoadMore } from "@/components/LoadMore";
import { PinIcon, PlusIcon } from "@/components/Icons";
import { AutoNear, NearMeButton } from "@/components/NearMe";
import { RADII } from "@/lib/geo";

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
  const base = { city: city.slug, near: f.near, tab: f.tab, cats: f.cats, free: f.free, dating: f.dating };
  const where = f.near ? `within ${f.near.radius} miles` : `in ${city.name}`;
  const href = (o: Partial<typeof base>) => `/?${feedQuery({ ...base, ...o })}`;
  const toggleCat = (id: string) => (f.cats.includes(id) ? f.cats.filter((c) => c !== id) : [...f.cats, id]);
  const visibleCats = CATEGORIES.filter((c) => c.id !== "dating" || f.dating);
  const tabLabel = TABS.find((t) => t.id === f.tab)!.label.toLowerCase();

  return (
    <>
      <main className="wrap">
        <header className="top">
          <a className="brand" href="/">{APP_NAME}</a>
          <a className="loc" href="/?pick=1" aria-label={`Location: ${f.near ? "near you" : city.name}. Change location`}>
            <PinIcon /> {f.near ? "Near you" : city.name}
          </a>
        </header>

        <nav className="tabs" aria-label="When">
          {TABS.map((t) => (
            <a key={t.id} className="tab" href={href({ tab: t.id })} aria-current={t.id === f.tab ? "page" : undefined}>{t.label}</a>
          ))}
        </nav>

        {f.near && (
          <div className="chips radius" role="group" aria-label="Distance">
            {RADII.map((r) => (
              <a key={r} className="chip" href={href({ near: { ...f.near!, radius: r } })} aria-pressed={f.near!.radius === r}>{r} mi</a>
            ))}
          </div>
        )}

        <div className="chips" role="group" aria-label="Filter events">
          <a className="chip" href={href({ cats: [] })} aria-pressed={f.cats.length === 0}>All</a>
          {visibleCats.map((c) => (
            <a key={c.id} className="chip" href={href({ cats: toggleCat(c.id) })} aria-pressed={f.cats.includes(c.id)}>{c.label}</a>
          ))}
          <a className="chip" href={href({ free: !f.free })} aria-pressed={f.free}>Free only</a>
          <a className="chip dating" href={`/prefs/dating?on=${f.dating ? "0" : "1"}&next=${encodeURIComponent(href({ dating: !f.dating, cats: f.cats.filter((c) => c !== "dating") }))}`}
             aria-pressed={f.dating}>{f.dating ? "Hide dating events" : "Show dating events"}</a>
        </div>

        {f.events.length === 0 ? (
          <section className="empty">
            <h2>Nothing listed {tabLabel === "tonight" ? "for tonight" : tabLabel} {where} yet</h2>
            <p style={{ color: "var(--soft)", margin: "0 0 16px" }}>
              {f.cats.length || f.free ? "Try fewer filters or a longer time range. " : "Try a longer time range. "}
              Know about something good? Share it and we&apos;ll add it.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {f.tab !== "month" && <a className="btn" href={href({ tab: "month" })}>See this month</a>}
              {f.near && f.near.radius < 50 && <a className="btn" href={href({ near: { ...f.near, radius: 50 } })}>Look within 50 miles</a>}
              <a className="btn pink" href="/share">Share an event</a>
            </div>
          </section>
        ) : (
          <section className="feed" aria-label={`Events ${where}`}>
            {f.events.map((e) => <EventCard key={e.id} e={e} />)}
            <LoadMore key={href({})} initialNext={f.next} query={feedQuery(base)} />
          </section>
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
          <div className="note">
            No cities have been set up yet. If you run this site, add a city in the admin area to get started.
          </div>
        ) : (
          <>
            <p>Events for the African diaspora, near you.</p>
            <NearMeButton />
            <h2 className="or">Or pick a city</h2>
            <div className="cities">
              {cities.map((c) => (
                <a key={c.id} href={`/city/${c.slug}`}>{c.name} <span aria-hidden="true">→</span></a>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
