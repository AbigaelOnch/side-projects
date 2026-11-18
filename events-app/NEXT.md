# Afro Social — where to pick up

Read this first when resuming. Then `SPEC.md` (what it must do, with scenario IDs), `PLAN.md` (how it's built) and `VALIDATION.md` (what's proven).
Follow the `software-factory` skill: new requests go to the Backlog in `SPEC.md` first; build in slices; validate before calling anything done.

## State on 2026-11-17

- Version **0.7.2**. Every capability in `SPEC.md` is built. Factory phase: **4 (Validate)**, partly done. Phase 5 (Ship) is done for the
  prototype only: pushed to `side-projects/events-app` on `main`, and running on the owner's Windows PC at `Documents\afro-social`.
- Proven: 93 logic tests, 47 browser checks against the production build, and a first real run on the owner's PC (2 Eventbrite links read,
  AI review, live address lookup).
- The owner works in auto mode and does not want to be asked for permission for routine steps. Decide, record it in `SPEC.md`, carry on.
  Still stop for: anything that spends money, publishes publicly, or needs their sign-in or secrets.

## Remaining work, in order

### 1. Finish validation with real data (owner's PC, key already saved)
- [ ] Real links from **Luma, Partiful, Posh, Meetup, Instagram, TikTok**, and a **flyer screenshot**. Target: 4 of 5 fill the preview within 10 s (S-020–S-023).
      Fix what the reader gets wrong per site (`src/lib/extract.ts`, `src/lib/submit.ts`).
- [ ] AI review on more real events, including junk: an advert, a past event, a vague post, a prompt-injection attempt (S-100–S-105).
      Tune `REVIEW_SYSTEM` in `src/lib/claude.ts` and bump `REVIEW_VERSION` in `src/lib/review.ts` when it changes.
- [ ] Follow 3–5 real organiser pages and see what comes in (S-042, S-044). Expect some sites to block reads; record which in `SPEC.md` §4.
- [ ] Share the same real event from two sites and confirm it merges (S-031).
- [ ] Owner to set `ADMIN_PASSCODE` in `.env.local` and try the admin page (queue, Decided by AI, duplicates, organisations).
- [ ] Update `VALIDATION.md` with the results.

### 2. Real phones
- [ ] Give the phone an https address for the PC app (a secure tunnel) or a private hosted preview. Location, clipboard paste and the share
      menu need https.
- [ ] iPhone Safari and Android Chrome: browse, near me, share, add to calendar, Share button, Add to Home Screen (S-084–S-088).
- [ ] Android: share an Instagram post into the installed app (S-086).
- [ ] Run the browser checks in WebKit as well as Chromium (`tests/e2e_*.py`, `tests/shots.py`).

### 3. Go public (Backlog items; each needs the owner's go-ahead because it costs money or publishes)
- [ ] Host on Vercel. Move the database from the local SQLite file to hosted Postgres (`src/lib/db.ts` is the only file that talks to the
      database; queries use SQLite syntax such as `strftime`, so they need porting). Move uploaded flyers from `data/uploads` to file storage.
- [ ] Replace the passcode with real admin sign-in (Better Auth preferred; Clerk is the alternative). Visitors must never need to log in.
- [ ] Set `SITE_URL` so shared links show previews. Add a captcha on sharing. Switch address lookup from OpenStreetMap to a paid provider.
- [ ] The followed-organisation timer (`src/instrumentation.ts`) assumes a long-running server; on Vercel it needs a scheduled job instead.
- [ ] Privacy note and terms page; a way for organisers to ask for an event to be removed.

### 4. Brand
- [ ] Name: "Afro Social" has had a quick search only. Do a full trademark, domain and social-handle check before launch. (FUBU, Pull Up and
      The Function were ruled out for trademark or confusion reasons.)
- [ ] Colours: owner said "there are better colours out there, we'll switch it up later". Plum stays until then. All colours are CSS
      variables at the top of `src/app/globals.css`; the owner rejected the brown "espresso" palette and the serif font ("old school").
      They want it **sleek and clean**: DM Sans, sentence case, no heavy display type.
- [ ] Replace the placeholder icon (`public/icon-*.png`) and the five made-up sample flyers (`sample-flyers/`).

### 5. Backlog features (see `SPEC.md` §12)
- [ ] "Singles this week" shortcut. Calendar feed subscription. Instagram hashtag watch (needs a Business account and Meta approval).
- [ ] Email when a shared event goes live. Optional organiser accounts. Saved events. Weekly "this week in {city}" email. Map view.
- [ ] Should AI review also cover Dating events? The owner hasn't answered; they currently always wait for the owner.

## Known rough edges
- A day with one event leaves empty space beside its card on wide screens.
- The Share button on an event page falls back to copying the link when there's no share menu; link previews only work once hosted.
- `admin.updateEvent` doesn't let the owner edit price, description, image, or dating details yet.
- Recurring-series detection needs the same weekday, time, place and a near-identical title; monthly "first Friday" patterns are labelled
  loosely ("Monthly on Fridays").
- Event 91 on the owner's PC has a doubled city in its address from before the fix; edit it in the admin page.

## Practical notes for whoever picks this up
- **Run:** `npm install`, `npm run seed`, `npm run dev` (owner: double-click `Start Afro Social.bat`). Needs Node 22+; the owner has Node 26.
- **Database:** Node's built-in `node:sqlite`, loaded with `process.getBuiltinModule`. Do not add `better-sqlite3`: it has no prebuilt Windows
  binary for Node 26 and failed to install on the owner's PC. Rows are copied into plain objects in `db.ts` because Next can't pass
  prototype-less objects to client components.
- **Tests:** `npm test` (logic). Browser checks: start the app (`npx next build && npx next start`), then run each `tests/e2e_*.py` with
  Python Playwright; they expect `ADMIN_PASSCODE=local-test-passcode` in `.env.local` of the test machine and leave "E2E …" rows behind that
  should be deleted afterwards. Kill any old `next-server` process before starting a new one, or the old build keeps serving.
- **Version:** bump `version` in `package.json` on every delivery; the footer and `/api/version` show it, which is how a stale running copy
  is spotted.
- **Delivering to the owner's PC:** copy changed files into `Documents\afro-social` (not `node_modules`, `data`, `.env.local`, `.next`), then
  the owner closes the black window and runs the start file. Never overwrite their `.env.local` or `data`.
- **Secrets:** the Claude key and passcode live only in the owner's `.env.local`. The repo is public.
- **Lesson from the first run:** test with the owner's real links early. Two real events found four problems that 90 passing tests had not.
