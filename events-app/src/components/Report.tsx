"use client";
import { useState } from "react";

export function Report({ eventId }: { eventId: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  if (state === "sent") return <p className="hint" role="status">Thanks. We&apos;ll take a look.</p>;
  if (!open) return <button type="button" className="link" onClick={() => setOpen(true)}>Report this event</button>;
  return (
    <form className="sheet-body report" onSubmit={async (e) => {
      e.preventDefault(); setState("sending");
      try {
        const r = await fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId, reason }) });
        setState(r.ok ? "sent" : "error");
      } catch { setState("error"); }
    }}>
      <label>What&apos;s wrong with it? <span className="opt">(optional)</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />
      </label>
      {state === "error" && <p className="warn" role="alert">That didn&apos;t send. Try again in a moment.</p>}
      <div style={{ display: "flex", gap: 10 }}>
        <button type="submit" className="btn" disabled={state === "sending"}>Send report</button>
        <button type="button" className="link" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
