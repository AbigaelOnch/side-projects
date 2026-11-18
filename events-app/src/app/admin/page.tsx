import { cookies } from "next/headers";
import { APP_NAME } from "@/lib/config";
import { isAdmin, needsLocation, openReports, passcodeSet, pending } from "@/lib/admin";
import { listCities } from "@/lib/events";
import { db } from "@/lib/db";
import { aiReviewOn, recentAiDecisions } from "@/lib/review";
import { openFlags, recentMerges } from "@/lib/dedupe";
import { listOrgs } from "@/lib/orgs";
import { AdminApp, AdminLogin } from "@/components/AdminApp";

export const dynamic = "force-dynamic";
export const metadata = { title: `Admin · ${APP_NAME}`, robots: { index: false } };

export default async function Admin() {
  const ok = isAdmin((await cookies()).get("afro_admin")?.value);
  return (
    <main className="wrap share">
      <header className="top"><a className="brand" href="/">{APP_NAME}</a><span className="hint" style={{ margin: 0 }}>Admin</span></header>
      <h1 className="share-h">{ok ? "Review" : "Admin sign-in"}</h1>
      {ok ? (
        <AdminApp orgs={listOrgs().map((o) => ({ id: o.id, name: o.name, page_url: o.page_url, trusted: !!o.trusted, city_name: o.city_name ?? null, last_checked: o.last_checked, last_result: o.last_result, last_error: o.last_error }))}
          flags={openFlags()} merges={recentMerges()} ai={recentAiDecisions()} aiOn={aiReviewOn() && !!process.env.ANTHROPIC_API_KEY} queue={pending()} reports={openReports()} noLocation={needsLocation()}
          cities={listCities().map((c) => ({ id: c.id, name: c.name, tz: c.tz }))} claude={!!process.env.ANTHROPIC_API_KEY}
          approvedCount={(db().prepare("SELECT COUNT(*) n FROM events WHERE status = 'approved' AND sample = 0").get() as { n: number }).n} />
      ) : <AdminLogin unset={!passcodeSet()} />}
    </main>
  );
}
