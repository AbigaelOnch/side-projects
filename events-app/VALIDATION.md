# Afro Social — validation status (version 0.7.2, 2026-11-17)

## Passing in the build sandbox
- **93 automated logic tests** (`npm test`): feed, time zones, filters, near me, link reading and safety, submissions, spam limits, admin sign-in
  and lockout, review queue, AI review, duplicates and unmerge, recurring series, singles filters, followed organisations, 2,000-event speed.
- **47 browser checks at phone and desktop sizes**, run against the production build (`tests/e2e_*.py`): share → review → public → report →
  remove; near me (allowed, denied, returning); sharing an event with friends; duplicates; filters; followed organisations in the admin page;
  layout at 360 / 768 / 1440 px, tap targets, contrast, keyboard use, reduced motion.
- **Production build** (`next build`) compiles cleanly.
- **Owner's PC (Windows 11, Node 26)**: runs at version 0.7.2. Two real Eventbrite links were read correctly (title, venue, address, time, flyer),
  the AI reviewer approved one and held one, the live address lookup placed the approved event, and the owner confirmed both are visible.
  That first real run found four problems, all fixed: events more than a month out were invisible, events shared before the key was saved
  were never reviewed, the reviewer held a genuine event over formatting, and new events were hard to find (now a "Just added" row).

## Not yet proven (needs the owner or the real world)
| What | Why it's open | Scenarios |
|---|---|---|
| Reading Luma / Partiful / Posh / Meetup / Instagram links and flyer screenshots | Only Eventbrite has been tried with real links so far (2 of 2 read correctly) | S-021–S-023, acceptance "4 of 5 real links" |
| AI review's judgement | Seen on 2 real events only; needs more, including junk submissions | S-100–S-102 |
| Checking real organiser pages | Sites may block automated reads; only tested with sample pages | S-042, S-044 |
| A real iPhone and Android phone, Add to Home Screen, Android share menu | Needs an https address the phone can reach | S-084–S-087 |
| iPhone Safari engine (WebKit) | Browser checks ran in Chromium only | S-084 |

## Known limits
- Location, clipboard paste and the share menu only work on https or on `localhost`.
- The app icon and sample flyers are placeholders.
- The name "Afro Social" has had a quick search only, not a full trademark, domain and handle check.
