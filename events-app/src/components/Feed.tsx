"use client";
import { useEffect, useRef, useState } from "react";
import { EventCard, type CardData } from "./EventCard";

/** The day-by-day feed. Loads the next page as the visitor scrolls near the end. */
export function Feed({ initial, initialNext, query }: { initial: CardData[]; initialNext: string | null; query: string }) {
  const [items, setItems] = useState<CardData[]>(initial);
  const [next, setNext] = useState(initialNext);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!next || !sentinel.current) return;
    const el = sentinel.current;
    const io = new IntersectionObserver(async (entries) => {
      if (!entries[0].isIntersecting || state === "loading") return;
      setState("loading");
      try {
        const r = await fetch(`/api/events?${query}&cursor=${encodeURIComponent(next)}`);
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { events: CardData[]; next: string | null };
        setItems((xs) => [...xs, ...j.events.filter((e) => !xs.some((x) => x.id === e.id))]);
        setNext(j.next);
        setState("idle");
      } catch {
        setState("error");
      }
    }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, query, state]);

  const groups: { key: string; label: string; sub: string; events: CardData[] }[] = [];
  for (const e of items) {
    const g = groups[groups.length - 1];
    if (g && g.key === e.day_key) g.events.push(e);
    else groups.push({ key: e.day_key, label: e.day_label, sub: e.day_sub, events: [e] });
  }

  return (
    <div className="days">
      {groups.map((g) => (
        <section key={g.key} className="daygroup" aria-label={`${g.label} ${g.sub}`}>
          <header className="day"><h2>{g.label}</h2>{g.sub && <span>{g.sub}</span>}</header>
          <div className="feed">{g.events.map((e) => <EventCard key={e.id} e={e} />)}</div>
        </section>
      ))}
      <div ref={sentinel} className="more">
        {state === "loading" ? "Loading more…" : state === "error" ? "Couldn't load more. Scroll to try again." : null}
      </div>
    </div>
  );
}
