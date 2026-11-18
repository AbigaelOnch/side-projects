# Events app — plan (v0.1, 2026-11-17)

Follows SPEC.md v0.4. Scenario IDs (S-xxx) link the spec, the tests and the evidence.

## Components

```
browser (phone / desktop)
  ├─ public pages: home feed, event page, submit sheet        (Next.js server components + small client islands)
  └─ admin pages: queue, events, orgs, cities, reports         (passcode session)
Next.js server
  ├─ /api/events        list (near-me / city, filters, cursor paging)
  ├─ /api/submit/read   link or image → draft event (reader pipeline)
  ├─ /api/submit        draft → pending (dedupe, rate limit, honeypot)
  ├─ /api/report        report an event
  ├─ /api/admin/*       approve / edit / merge / unmerge / reject, orgs, cities, check-now
  ├─ /api/version
  └─ jobs (in-process timer while running): org checks ≤2×/day, geocode queue (1 req/s)
lib/
  ├─ reader/   safeFetch (SSRF guard, 3 MB, 10 s, ≤3 redirects) → jsonld → opengraph → claude
  ├─ dedupe/   normalise title, venue; same-link; fuzzy match (day, ±60 min, title similarity, venue)
  ├─ geo/      nominatim client with cache; haversine; coordinate rounding
  └─ db/       Drizzle schema + migrations (SQLite now, Postgres later)
data/ (git-ignored): app.db, uploads/
```

## Data model (first cut)

- **events**: id, title, start_utc, end_utc, tz, venue_name, address, city_id, lat, lng, online, price_min, price_text, image_path,
  organiser, description, category, singles_friendly, go_solo, dating_format, age_range, audience_tags, dress_code, structure,
  spots_text, series_id, status (pending|approved|rejected|merged), merged_into, auto_approved, created_at, approved_at
- **event_sources**: event_id, url (unique, normalised), platform, first_seen, from (submit|org|admin)
- **submissions**: id, event_id, submitter_email?, ip_hash, device_hash, raw_extract (json), created_at
- **series**: id, title, rule_text, organiser
- **orgs**: id, name, page_url, platform, trusted, city_id, last_checked, last_error, allowed (bool + note)
- **cities**: id, name, tz, lat, lng, radius_mi
- **reports**: id, event_id, reason, created_at, handled
- **dupe_flags**: event_a, event_b, score, resolved
- **geocode_cache**: address_norm, lat, lng, ok
- **admin_sessions**, **login_attempts**, **rate_limits**

## Security and approval rules (from the spec)

Nothing is public until approved (trusted orgs are the exception, never for Dating). Pages and flyers are untrusted: Claude gets a fixed
extraction schema and is told to ignore instructions in the content. Output is validated with zod, and all text is rendered as text.
The safe fetcher blocks private and loopback addresses after DNS lookup and on every redirect. Uploads are images only, re-encoded with sharp.
Admin: passcode, http-only cookie, CSRF token, lockout. Visitor location: rounded to about 1 km on the client and never logged or stored.

## Environment matrix (validation)

| Axis | Values |
|---|---|
| OS / browser | Windows 11 + Edge/Chrome (owner); Playwright Chromium + WebKit (iPhone-sized) in the sandbox |
| Widths | 360, 768, 1440 |
| Theme | dark (direction B) |
| State | first run (empty DB), seeded (≈60 events, 3 cities), large (2,000 events) |
| Network | online; Claude key missing / invalid / out of credit; link timeout; offline |
| Upgrade | old server still running (version mismatch), restart keeps data, second copy started |

## Build order (vertical slices)

1. **Skeleton + feed**: Next.js app, DB schema, seed data, home feed by city with category and date filters, event page, .ics, version footer, start `.bat`.
   Scenarios: S-001/002/010–016, S-070–072.
2. **Near me**: location prompt on tap, radius, distances, fallback to city, geocoding on approve.
   Scenarios: S-004–009.
3. **Submit**: paste link or flyer → reader pipeline → preview → submit; safety (SSRF, uploads, rate limit, honeypot).
   Scenarios: S-020–029, S-050–053, S-060–066.
4. **Admin**: passcode, queue (approve, edit, reject), reports, cities.
   Scenarios: S-040, S-041, S-045–047, S-095.
5. **No duplicates + series**: same link, fuzzy merge, possible-duplicate flags, unmerge, recurring series.
   Scenarios: S-030–034.
6. **Followed orgs**: add org, scheduled and on-demand checks, trusted auto-approve, errors.
   Scenarios: S-042–044, S-094.
7. **Singles**: formats, audience labels, singles-friendly, go-solo, dating hidden by default, safety note.
   Scenarios: S-090–093, S-096.
8. **Polish + scale**: 2,000-event paging, a11y, reduced motion, layout matrix.
   Scenarios: S-003, S-080–083.

Each slice: implement → tests for its scenario IDs → run → commit locally (no push until the prototype passes validation).

## Look and feel

Three directions are mocked up on a design canvas (source in `mockups/`): phone home feed plus the share sheet, each showing a
different submit state (filled preview, Instagram fallback, already listed). The owner picks one; the desktop layout and
token set follow from it in slice 1.
