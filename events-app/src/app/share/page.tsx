import { APP_NAME } from "@/lib/config";
import { BackIcon } from "@/components/Icons";
import { ShareSheet } from "@/components/ShareSheet";

export const dynamic = "force-dynamic";

// Also the Android share target: shared posts arrive as ?url=… or ?text=… (S-086).
export default async function Share({ searchParams }: { searchParams: Promise<{ url?: string; text?: string; title?: string }> }) {
  const sp = await searchParams;
  const shared = [sp.url, sp.text, sp.title].find((v) => v && /https?:\/\/|\.[a-z]{2,}\//i.test(v)) ?? "";
  return (
    <main className="wrap share">
      <header className="top">
        <a className="back" href="/"><BackIcon /> Events</a>
        <a className="brand" href="/">{APP_NAME}</a>
      </header>
      <h1 className="share-h">Share an event</h1>
      <ShareSheet initial={shared.slice(0, 2000)} />
    </main>
  );
}
