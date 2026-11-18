# Afro Social

Events near you for the African diaspora: networking, career and tech, social and culture, wellness, and dating.
No login for visitors. Prototype, running locally. See `SPEC.md` for what it does and `PLAN.md` for how it's built.

## Run it on Windows

1. Install Node.js LTS from https://nodejs.org (once).
2. Double-click **Start Afro Social.bat**. The first run installs what it needs, then opens http://localhost:3000.
3. Optional: double-click **Add sample events.bat** to fill it with made-up events in Oakland, San Francisco and Los Angeles.

Keep the black window open while you use the app; close it to stop. Double-clicking the start file again while it's running
just opens the app.

After an update, close the black window and start it again. The version in the page footer should match `/api/version`.

## Status

Slice 1 of 8 built: city feed with Tonight / This weekend / This week / This month, category and Free filters, dating hidden by
default, recurring events shown once, event pages, Add to calendar. Next: Near me, then one-step sharing.

## Developer

```
npm install
npm run seed      # sample data
npm run dev       # http://localhost:3000
npm test          # unit tests
```

Data lives in `data/` (git-ignored). Secrets go in `.env.local` (git-ignored); see `.env.example`.
