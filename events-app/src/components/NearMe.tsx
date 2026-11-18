"use client";
import { useEffect, useState } from "react";

const round = (x: number) => Math.round(x * 100) / 100; // ~1 km: all the server ever sees (S-009)

function setNearCookie(on: boolean) {
  document.cookie = `near=${on ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
}

function locate(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: round(p.coords.latitude), lng: round(p.coords.longitude) }),
      (e) => reject(e),
      { timeout: 10000, maximumAge: 10 * 60 * 1000, enableHighAccuracy: false },
    );
  });
}

function goNear(p: { lat: number; lng: number }, radius: number, keep = "") {
  const q = new URLSearchParams(keep);
  q.delete("city"); q.delete("pick"); q.delete("nonear");
  q.set("near", `${p.lat},${p.lng}`);
  q.set("r", String(radius));
  window.location.replace(`/?${q.toString()}`);
}

/** The "Show events near me" button. Location is only requested when it's tapped (S-004). */
export function NearMeButton({ radius = 25 }: { radius?: number }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  return (
    <div>
      <button type="button" className="btn pink nearbtn" disabled={state === "busy"} onClick={async () => {
        setState("busy");
        try {
          const p = await locate();
          setNearCookie(true);
          goNear(p, radius);
        } catch {
          setNearCookie(false);
          setState("failed");
        }
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="8" /></svg>
        {state === "busy" ? "Finding you…" : "Show events near me"}
      </button>
      {state === "failed" && (
        <p className="hint" role="status">No problem, pick a city instead. You can turn on location any time.</p>
      )}
    </div>
  );
}

/** Returning visitor who used "near me" before: if the browser still allows location, go straight there without asking (S-007). */
export function AutoNear({ radius, fallback }: { radius: number; fallback: string }) {
  useEffect(() => {
    let done = false;
    const give = () => { if (!done) { done = true; window.location.replace(fallback); } };
    const t = setTimeout(give, 6000);
    (async () => {
      try {
        const perm = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
        if (perm && perm.state !== "granted") return give();
        const p = await locate();
        if (!done) { done = true; clearTimeout(t); goNear(p, radius); }
      } catch { give(); }
    })();
    return () => clearTimeout(t);
  }, [radius, fallback]);
  return <p className="hint" role="status" style={{ padding: "40px 4px" }}>Finding events near you…</p>;
}

/** Leaving "near me" for a city clears the remembered choice. */
export function ForgetNear() {
  useEffect(() => setNearCookie(false), []);
  return null;
}
