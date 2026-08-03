# ACTION_LOG.md — chronological record of what was actually done

Newest entries at the top. One entry per meaningful action, not per keystroke.

## 2026-08-03 (session 2 — real code)
- Reconciled cloud repo history with the real `origin/main` (existing README.md);
  restructured folders to match the README's proposed layout (`draft-app/`,
  `season-app/`, `shared/`) plus `/api` (Yahoo/ESPN proxy) and `/docs`.
- Added ESPN as a second platform: league 647918841, redraft, PPR, draft upcoming —
  needs Phase 1 draft support same as Yahoo. Credentials (SWID/espn_s2, Yahoo Client
  ID, league IDs) stored in `.env.local`, confirmed git-ignored.
- Wrote `docs/DATA_SOURCES.md` (endpoint-level detail, kept separate from CONTEXT.md).
- Refined Kalshi feature to a labeled badge + separate combos-builder module (not
  blended into roster/draft logic) per user-supplied design guidance.
- Wrote real code for the first time this session:
  - `api/_lib/types.ts` — provider-agnostic data model (CanonicalPlayer, LeagueSettings,
    TeamRoster, DraftPick).
  - `api/_lib/yahoo.ts`, `api/_lib/espn.ts` — server-side provider clients.
  - `api/yahoo/token.ts`, `api/yahoo/proxy.ts`, `api/espn/league.ts` — the actual
    serverless endpoints. Type-checked clean (`npx tsc --noEmit -p api/tsconfig.json`).
  - `shared/storage.js`, `data-sources.js`, `yahoo-auth.js` (PKCE client flow),
    `espn-client.js` — browser-side glue.
  - `shared/scoring-engine.js`, `preference-engine.js` — real signatures/structure,
    math intentionally stubbed (throws) until the player-ID crosswalk and a real
    projections source exist; see comments in each file.
  - `draft-app/draft-app.html`, `styles.css`, `app.js` — a working connect/status page
    (tabs, theme toggle, Yahoo connect button, ESPN test-connection button, settings
    sliders) implementing the design system. NOT the full draft board yet.
  - `package.json`, `vercel.json`, `api/tsconfig.json`, `.gitignore`.
- Known real gaps, not yet solved: (1) `draft-app/app.js` expects
  `window.__YAHOO_CLIENT_ID__` to be injected — nothing injects it yet, so the Yahoo
  connect button will not work until that's wired up (needs a small build step or a
  non-secret injection point); (2) ESPN endpoint host
  (`lm-api-reads.fantasy.espn.com`) is per community docs, not verified against a real
  request yet; (3) whether Kalshi's public endpoints send permissive CORS headers is
  assumed, not tested.
- Committed locally (`ea4df40`, `2fc05ab`, `f8c510d`, and this session's code) — still
  cannot push, no GitHub credentials in this sandbox yet (user chose to provide a
  scoped PAT, hasn't sent it yet).

## 2026-08-03 (session 1)
- Initialized git repo at `/home/claude/ffl-26`, set `origin` to
  https://github.com/gloconllc/ffl-26.git (not yet pushed — no commits made yet).
- Installed 4 skills from machina-sports/sports-skills via `npx skills add`:
  nfl-data, kalshi, betting, markets.
- Cloned (research only, not installed as a dependency) two reference repos:
  - derekrbreese/fantasy-football-mcp-public — mined for algorithm patterns (VORP,
    lineup optimizer, matchup analyzer, projection-enhancement layer). Decision: port
    logic into our own TS serverless functions, do not run as a separate service.
  - machina-sports/sports-skills — source of the installed skills above.
- Reviewed a user-supplied table of sport data sources (mostly soccer/track/volleyball/
  F1 — not NFL-relevant) and a user-supplied external case study on building a similar
  app ("FantasyAgent," adamrubinsky.com). Extracted transferable lessons into
  CONTEXT.md; did not change stack/architecture.
- Set architecture: static frontend + small Vercel serverless functions, localStorage/
  IndexedDB persistence, free/public data only (explicitly skip PFF/FantasyPros
  scraping), Kalshi/Polymarket surfaced as labeled market-signal data only (not
  disguised picks or trade recommendations).
- Created `docs/CONTEXT.md`, `docs/ACTION_LOG.md`, `docs/ISSUE_LOG.md` as persistent
  cross-session documentation, per lesson from the FantasyAgent case study.
- Repo folder structure created: `/api`, `/public/css`, `/public/js/engine`, `/docs`.
- Still waiting on Group 1 league facts from user (league ID, team count, scoring
  quirks, draft date/rounds) — asked three times, not yet answered.
