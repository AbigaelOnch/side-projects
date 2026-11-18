import { APP_NAME } from "@/lib/config";
import { BackIcon } from "@/components/Icons";

export default function Share() {
  return (
    <main className="wrap">
      <header className="top"><a className="brand" href="/">{APP_NAME}</a></header>
      <section className="pick">
        <a className="back" href="/"><BackIcon /> Back to events</a>
        <h1 style={{ marginTop: 12 }}>Share an event</h1>
        <div className="note">Sharing by link or flyer is coming in the next build.</div>
      </section>
    </main>
  );
}
