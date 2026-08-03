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
