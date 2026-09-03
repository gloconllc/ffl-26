# DATA_SOURCES.md — concrete endpoints/auth per source

Endpoint-level detail lives here, not in CONTEXT.md, so that file stays about
decisions/architecture rather than growing without bound. Update this as each source
actually gets wired in and tested — note here if something behaves differently than
documented.

## Yahoo Fantasy Sports
- Base: `https://fantasysports.yahooapis.com/fantasy/v2/`
- Auth: OAuth 2.0, Public Client (no client secret — PKCE). App ID `wOA1uRYJ`, Client ID
  in `.env.local` as `YAHOO_CLIENT_ID`.
- No CORS support for browser calls — token exchange and all reads go through our
  `/api` serverless proxy, never directly from client-side JS.
- League ID: 865803 (see CONTEXT.md)

## IMPORTANT: this cloud sandbox cannot live-test most of these sources — but CAN reach github.com/raw.githubusercontent.com
Discovered 2026-08-03: this Claude session's Bash tool routes outbound traffic through
an allowlisted proxy (npm/pypi/github/anthropic domains only) — direct `curl` to
`fantasy.espn.com`/`lm-api-reads.fantasy.espn.com`, `api.sleeper.app`,
`api.open-meteo.com`, and `external-api.kalshi.com` all get blocked at the *proxy
itself* (confirmed via `curl -v` — connection refused / 000, not a provider-side
rejection). Yahoo, ESPN, Sleeper, Open-Meteo, and Kalshi connectivity genuinely cannot
be verified from inside this sandbox — real testing needs `vercel dev`/a browser on
the user's own machine, or a real Vercel deployment (serverless functions there have
unrestricted egress).

**BUT confirmed reachable from here (2026-08-03): `github.com` and
`raw.githubusercontent.com`, including GitHub *release asset* downloads** (which
redirect through `github-cloud.s3.amazonaws.com` and still resolve). This is why the
real player-data pipeline (below) could actually be built and verified in this
session, unlike Yahoo/ESPN/Kalshi — it's pulled entirely from GitHub-hosted release
assets.

## Player stats, identity, schedule, injuries — REAL, wired in and verified 2026-08-03
Source: **nflverse-data** (`https://github.com/nflverse/nflverse-data`), an MIT-licensed
community project built on official NFL data feeds. Implementation:
`scripts/build-player-data.mjs` (run with `npm run build:data`), output:
`shared/data/players-live.json` + `shared/data/team-context-2026.json`. Both output
files carry their own `_README` field with exact provenance/caveats — read those before
trusting a number, don't just trust this doc.

Endpoints actually used (all release-asset downloads under
`https://github.com/nflverse/nflverse-data/releases/download/...`):
- `players_components/players.csv` — cross-source player identity crosswalk (gsis_id,
  espn_id, pfr_id, sleeper_id, etc. — this is the "canonical player ID crosswalk"
  TODO from CONTEXT.md, now actually solved for identity purposes). Includes
  `status`/`last_season` — filter on both, since the crosswalk spans all NFL history
  and stale `status: ACT` rows exist for long-retired players.
- `player_stats/player_stats.csv` (~33MB, all seasons 1999-2024) — real per-player,
  per-week box score stats **including a pre-computed `fantasy_points_ppr` column** —
  use that directly rather than re-deriving PPR scoring from raw columns.
  **Verified empirically 2026-08-03: this release only contains seasons through
  2024** — 2025 was not yet present. Re-check `STATS_SEASON` in the build script
  before assuming otherwise on a future run.
- `player_stats/player_stats_def.csv` — team defense stats (sacks/INTs/fumble
  recoveries/TDs), used for a simplified team-DEF scoring proxy.
- `injuries/injuries_{season}.csv` — official injury report designations per player
  per week; the build script keeps only the most recent week's designation per player.
- `schedules/games.csv` — full schedule across ALL seasons in one file, filter by
  `season`. **Confirmed the 2026 season schedule is already present, including posted
  Week 1 moneylines/spreads/totals and head coach names** — this is what feeds the
  Contextual scoring tier and `team-context-2026.json`. Lines will move before kickoff;
  treat as directional, not live.

**Known gaps, honestly stated (do not silently paper over these):**
- No free source of real 2026 fantasy *projections* exists yet. `projectedPoints` is
  derived from each player's 2024 per-game scoring rate × 17 — an estimate, not an
  official projection. Swap this the moment a free projections/ADP feed is found.
- Kicker scoring is effectively unusable (`fantasy_points_ppr` doesn't cover FG/XP
  stats in this file) — all kickers currently score 0. Needs a separate kicker-scoring
  data source.
- Team-defense scoring is a simplified sacks/turnovers/TDs-only proxy, not a full
  points-allowed model.
- Rookies drafted into the league after this crosswalk snapshot was taken won't appear
  until the crosswalk is refreshed — re-run `npm run build:data` periodically, this is
  meant to be re-run (that's the Phase 2 "daily/on-demand refresh" mechanism, currently
  manual).

## ESPN Fantasy Football (private league)
- Base (current, per community libraries as of 2026-08-03):
  `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{leagueId}`
  (legacy `https://fantasy.espn.com/apis/v3/...` also seen in older docs/libraries —
  verify which resolves correctly when we actually implement this, endpoints have moved
  before)
- Auth: no official API. Private leagues require `SWID` and `espn_s2` sent as cookies
  on the request (`Cookie: SWID={...}; espn_s2=...`). These are the user's own ESPN
  session credentials — stored in `.env.local` as `ESPN_SWID` / `ESPN_S2`, read only
  server-side inside the `/api` ESPN proxy function, never sent to the browser.
- League ID: 647918841 (see CONTEXT.md)
- Useful query params seen in community docs: `?view=mRoster`, `?view=mTeam`,
  `?view=mMatchup`, `?view=mDraftDetail` — confirm exact views needed when building.

## Kalshi (prediction markets — public market data only, no trading)
- Base: `https://external-api.kalshi.com/trade-api/v2`
- Auth: **none required** for public market-data endpoints (confirmed via Kalshi's own
  quick-start docs, 2026-08-03). Only portfolio/orders/trading/authenticated WebSocket
  need signed RSA-PSS requests — we never touch those.
- Endpoints to use: `/series`, `/events`, `/markets` (e.g. `?status=open`),
  `/markets/{ticker}/orderbook`
- Price scale: 0-100 integer, read as a percentage implied probability (last_price=20
  → 20%). Not American odds, not 0-1 like Polymarket.
- TODO when implementing: check whether these public endpoints send permissive CORS
  headers — if so, the badge/icon feature can call Kalshi directly client-side with no
  serverless proxy needed (unlike Yahoo/ESPN, which need one regardless because of
  auth). Verify empirically rather than assuming.
- UI treatment: small "K" badge on player/team cards; hover/tap shows price + implied
  probability + trend vs. previous snapshot; click adds/removes the event from a
  separate combos/parlay builder module, kept apart from the roster/draft engine. See
  ISSUE_LOG.md 2026-08-03 for the reasoning behind this boundary.

## Polymarket (queued, not wired in yet)
Shares a similar public interface to Kalshi per the `markets` skill (`search_markets`,
`get_todays_events`, `get_sports_config` work the same way on both per that skill's
docs). Add alongside Kalshi using the same badge pattern when we get to it.

## Free NFL stats/projections (queued, not wired in yet)
nflverse/nflfastR-style datasets, Sleeper's public read API — exact endpoints TBD when
we build the projections/efficiency tiers. Do NOT scrape PFF or FantasyPros
premium/ECR — see ISSUE_LOG.md.

## Weather
Open-Meteo — `https://api.open-meteo.com/v1/forecast` (free, no key). Queued, not wired
in yet.

## Vegas lines / odds
The Odds API — `https://api.the-odds-api.com/v4/...` — requires the user's own free-tier
API key (not yet provided). Queued.
