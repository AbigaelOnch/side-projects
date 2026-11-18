"use client";
import { useState } from "react";

/** Send an event to someone: the phone's own share sheet where there is one, otherwise copy the link. */
export function ShareEvent({ title, text }: { title: string; text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const url = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
  async function go() {
    const link = window.location.origin + window.location.pathname;
    if (navigator.share) {
      try { await navigator.share({ title, text, url: link }); return; }
      catch (e) { if ((e as Error).name === "AbortError") return; } // closed the sheet: nothing to do
    }
    try { await navigator.clipboard.writeText(link); setState("copied"); setTimeout(() => setState("idle"), 2500); }
    catch { setState("manual"); }
  }
  return (
    <>
      <button type="button" className="btn" onClick={go} aria-live="polite">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></svg>
        {state === "copied" ? "Link copied" : "Share"}
      </button>
      {state === "manual" && (
        <label className="sheet-body" style={{ flexBasis: "100%" }}>Copy this link
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        </label>
      )}
    </>
  );
}
