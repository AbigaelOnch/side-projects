"use client";
import { useEffect, useRef, useState } from "react";
import { EventCard, type CardData } from "./EventCard";

/** Loads the next page of cards as the visitor scrolls near the end of the feed. */
export function LoadMore({ initialNext, query }: { initialNext: string | null; query: string }) {
  const [items, setItems] = useState<CardData[]>([]);
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
        setItems((xs) => [...xs, ...j.events]);
        setNext(j.next);
        setState("idle");
      } catch {
        setState("error");
      }
    }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, query, state]);

  return (
    <>
      {items.map((e) => <EventCard key={e.id} e={e} />)}
      <div ref={sentinel} className="more" style={{ gridColumn: "1 / -1" }}>
        {state === "loading" ? "Loading more…" : state === "error" ? "Couldn't load more. Scroll to try again." : next ? "" : null}
      </div>
    </>
  );
}
