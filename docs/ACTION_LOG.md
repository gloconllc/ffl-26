# ACTION_LOG.md — chronological record of what was actually done

Newest entries at the top. One entry per meaningful action, not per keystroke.

## 2026-08-03 (session 3 — unified-app pivot + Strategy preset selector)
- **Architecture pivot, directly from the user:** "the draft is just a piece of the
  overall app... draft, season lineup optimizer, trade optimizer, free agent
  optimizer, kalshi picks — all included in this app, they all work together, not
  separate — that's what will separate me from the rest." Recorded as a load-bearing
  decision in `docs/CONTEXT.md`. This is one app, not a draft product plus a separate
  season product.
- Renamed the visible app from "FFL 26 — Draft Assistant" to "FFL 26 — Command
  Center" (`<title>`, header brand, header subtitle listing every module) in
  `draft-app/draft-app.html`. Kept the folder/file name `draft-app/draft-app.html` as
  the actual entry point (renaming the file would mean re-wiring `vercel.json`
  rewrites and every asset path for zero user-visible benefit — the URL is always
  `/`, the filename is an internal detail) but it is now documented in CONTEXT.md as
  the one app shell, not a draft-only page.
- Added four new tabs/panels to that same shell — Lineup, Trades, Free Agents,
  Markets — each currently a clearly labeled "not built yet, queued Phase 2" banner
  that explicitly states it will share the same roster state, scoring engine, and
  preference layer as Draft once built, rather than being separate mini-apps.
- Corrected a stale claim in `docs/CONTEXT.md` that `shared/kalshi-client.js` already
  existed — it does not (verified by directory listing); the Kalshi badge remains
  designed but not yet coded. Flagging this now so a future session doesn't assume
  it's done.
- Built the **Strategy preset selector** the user asked for ("the settings should be
  more of you chose, then the brain then custom to see the weight difference then we
  can make a selection... have this setting available there before finalizing the
  pick"):
  - `draft-app/app.js`: `getStrategyPreset()`/`setStrategyPreset()`,
    `getNeedAwarenessSlider()`/`setNeedAwarenessSlider()`, `effectiveNeedAwareness()`,
    `sortByStrategy(ranked, neededPositions, needAwareness)`. Need-awareness (0..1) is
    the one axis that genuinely reorders recommendations today — with only the
    Projections tier implemented, scaling that tier's own weight can't change ranking
    order (multiplying every score by the same constant preserves order), so the three
    presets are wired to this real, testable axis: **Recommended** = 1 (an open roster
    need always outranks pure score — the original hard-sort behavior, reproduced
    exactly via a boost equal to the pool's max score), **The Brain** = 0 (pure
    VORP/tier score, needs ignored entirely — "the most points at all times no matter
    what"), **Custom** = user's own slider value in between.
  - Added the preset select to Settings (shared across the whole app) AND an inline
    quick-pick on the Recommendation tab itself, in sync via the same storage key —
    satisfies "have this setting available there before finalizing the pick," not
    buried on a separate tab.
  - `renderRecommendation()` now also computes what Recommended vs. The Brain would
    each pick right now and shows the honest delta whenever they actually differ, so
    the user sees the weight/outcome difference before committing to a pick, exactly
    as asked.
- Wired the previously-unused personal preference layer (`shared/preferences.js`,
  `shared/preference-engine.js`) into the actual UI for the first time — a new
  `renderPreferenceLayer()` in `app.js`, rendering into a new
  `#preference-layer-content` div on the Recommendation tab. Shows the model's real
  #1 pick under whichever strategy mode is active, the user's stated preference
  (e.g. Lamar Jackson at pick 1) if one is still on the board, the honest VORP delta
  between them, and two buttons — take the model's pick, or override and take the
  preferred one (override path calls `acknowledgeOverride()` and logs it, then drafts
  normally; per the founding rule, nothing about an override changes future scoring).
- Ran `npm run selftest` after all changes — both `engine.selftest.mjs` and
  `draft-flow.selftest.mjs` still pass unchanged (this feature only changes UI-layer
  sorting/rendering, not the underlying scoring/draft-state engines).

## 2026-08-03 (session 2, full draft-app build-out — "build the entire app")
- Built a genuinely playable/usable draft flow, not just a connect page. New modules:
  - `shared/data/placeholder-players.json` — ~120 players across all positions.
    **PLACEHOLDER/SYNTHETIC** — real player names, made-up projections/ADP, clearly
    labeled as such in the file, in a UI banner, and here. Not real 2026 rankings.
    Sized for roughly an 8-round demo draft, not a full 15-round one — expand before
    relying on it for anything longer.
  - `shared/draft-state.js` — provider-agnostic draft engine: snake pick-order math,
    available-player derivation, roster-needs calculation, persisted via storage.js
    so a refresh mid-draft doesn't lose state (per the standing architecture decision).
  - `shared/mock-draft.js` — practice-mode opponent AI (best-available VORP with a
    need-filling bias) so the user can practice against something plausible.
  - `shared/live-sync.js` — the integration point for real-time use during an actual
    Yahoo/ESPN draft (per user's explicit ask — "setup draft to be used in real time
    so I know what to pick next"). Real structure, but genuinely NOT verified: we
    don't have a real draftresults payload shape from either provider yet, so
    `mapPick()` is left as a caller-supplied function rather than guessed at. Needs a
    real or practice live draft on Yahoo/ESPN to finish and verify.
  - `shared/data-sources.js`: added `DEFAULT_ROSTER_SLOTS` (standard redraft roster,
    used until we read a league's real settings).
- Wired `shared/scoring-engine.js`'s `scoreProjectionsTier()` into the actual UI —
  Available Players table and the Recommendation panel both rank by real VORP + tier
  data now, not placeholders.
- Rewrote `draft-app/draft-app.html` + `app.js` + `styles.css` substantially: a Draft
  Setup card (team count/slot/mode), a full Draft Board (pick history table,
  "Simulate to my turn"), Available Players (sortable/filterable, Draft button), Top-3
  Recommendation cards (real reasoning bullets, tier-cliff warnings), My Roster
  (drafted players + remaining starting needs).
- Added `shared/draft-flow.selftest.mjs` — end-to-end test (not just isolated math)
  running the real placeholder dataset through draft-state + mock-draft +
  scoring-engine together for a simulated 8-round draft. Caught a real, useful finding
  worth knowing: pure best-VORP picking with NO need-awareness drafted 5 WRs before a
  single QB/TE/K/DEF — confirms the need-aware sort used in the actual UI
  (`renderRecommendation` in app.js) is load-bearing, not cosmetic. The raw test
  intentionally uses pure VORP to demonstrate this; the app itself does not have this
  problem. `npm run selftest` now runs both test files; both pass.
- Honest gaps still open: efficiency/contextual/risk tiers remain stubbed (settings
  sliders for them persist but don't affect anything yet — the UI now says this
  plainly rather than overclaiming); live-sync's payload mapping is unverified;
  Yahoo/ESPN league settings (real roster slots, scoring quirks) aren't pulled in yet,
  so DEFAULT_ROSTER_SLOTS is a stand-in.

## 2026-08-03 (session 2, "brain" work + gap closing)
- Closed the Yahoo Client ID gap: added `shared/config.js` (non-secret, safe in client
  code per the Public Client/PKCE model) and wired it into `draft-app/app.js`, removing
  the dead `window.__YAHOO_CLIENT_ID__` reference that nothing ever set.
- Tried to live-verify the ESPN endpoint host with the real league credentials —
  discovered this sandbox's Bash tool only has allowlisted network egress (npm/pypi/
  github/anthropic), so ESPN (and almost certainly Kalshi/Odds API/Open-Meteo/Yahoo)
  can't be reached from here at all — confirmed it's the sandbox's own proxy returning
  403, not ESPN. Logged in docs/DATA_SOURCES.md. Real verification needs to happen via
  the user's own machine (`vercel dev`) or after a real Vercel deploy.
- Real "brain" progress, not just plumbing (per user's explicit priority): wrote
  `shared/replacement-value.js` (VORP) and `shared/tiering.js` (tier-cliff detection),
  both pure functions with no I/O so they're testable without live data. Wrote
  `shared/engine.selftest.mjs` with synthetic data and ran it — all assertions passed
  (`node shared/engine.selftest.mjs`). Wired the result into
  `shared/scoring-engine.js` as `scoreProjectionsTier()` — this one function is now
  real, not stubbed. `scorePlayer()` (all 4 tiers combined) is still stubbed pending
  the other three tiers.
- Added `shared/package.json` (`{"type": "module"}`) scoped to just that folder so the
  self-test runs clean without a Node module-type warning, without touching the root
  package.json (which needs to stay CommonJS-compatible for the `/api` TS functions).

## 2026-08-03 (session 2 cont'd)
- User provided a GitHub PAT. Pushed all 4 pending commits to `origin/main`
  (`f15f005..9651654`) using the token inline on the push URL for a single command —
  never stored via `git config`, never written to any file. Repo and local workspace
  are now in sync.
- Declined a stop-hook request to run `git config` + rewrite commit history
  (`rebase --exec ... --reset-author`) to make commits show as "Verified" on GitHub —
  git config changes are outside what gets done here regardless of source, and it's a
  cosmetic issue (unsigned bot commits), not a functional one.

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
