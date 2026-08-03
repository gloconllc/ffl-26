# CONTEXT.md — read this first, every session

This file is the source of truth for what this project is and where it stands. Update
it whenever a real decision is made. This convention is deliberate: AI coding sessions
lose context between conversations, so this file (plus ACTION_LOG.md and ISSUE_LOG.md)
is what lets any future session — human or AI — pick up without re-deriving decisions.

## What this is

A two-phase Fantasy Football Intelligence Platform for a real Yahoo Fantasy Football
league, owned by John Picou (GloCon Solutions / personal project, unrelated to Visit
Anaheim work). Phase 1: a draft-day assistant. Phase 2: a season-long dashboard
(lineups, trades, waivers, weekly intel). Deploys to Vercel, source lives at
https://github.com/gloconllc/ffl-26.

## Confirmed league facts
- Yahoo league ID: **865803** — Snake draft, PPR (quirks beyond PPR still unconfirmed)
- ESPN league ID: **647918841** — second team, second league, added 2026-08-03.
  Redraft league, PPR scoring, draft still upcoming — **Phase 1 draft assistant needed
  for BOTH leagues**, not just Yahoo. Team count/exact draft date/rounds unconfirmed.
- Draft window (Yahoo league): 2–4 weeks out from 2026-08-03; ESPN draft timing unknown
- Team count, exact draft date/rounds (both leagues) — still unconfirmed, see Open Qs
- DST vs IDP — read from each league's actual settings once connected, not hardcoded

## Credentials — where they actually live (NEVER put real values in this file or any
other committed file; this section documents *what exists and where*, not the values)
- `/home/claude/ffl-26/.env.local` — confirmed git-ignored (`git check-ignore` verified
  2026-08-03). Contains: `YAHOO_LEAGUE_ID`, `YAHOO_APP_ID`, `YAHOO_CLIENT_ID` (Yahoo app
  is a Public Client — no client secret exists for it, the Client ID is not
  highly sensitive by design), `ESPN_LEAGUE_ID`, `ESPN_SWID`, `ESPN_S2`.
- **ESPN_SWID / ESPN_S2 are session-auth cookies from the user's own logged-in ESPN
  account** — functionally equivalent to being logged in as them for ESPN Fantasy
  purposes. Treat with the same care as a password: never log them, never write them
  into any file that gets committed or displayed, only read them server-side inside
  the `/api` ESPN proxy function, never send them to the browser/client-side JS. They
  were pasted directly into chat by the user (their choice) — flagged once, not
  belabored; going forward, real values only ever go into `.env.local`, never restated
  in docs, commit messages, or responses.
- GitHub push credentials (fine-grained PAT) — still pending, see ISSUE_LOG.md.

## ESPN Fantasy integration — architecture decision (2026-08-03)
ESPN has no official public Fantasy Sports API/OAuth (unlike Yahoo). The established
community pattern (confirmed via search — see mkreiser/ESPN-Fantasy-Football-API,
cwendt94/espn-api, ffscrapr) for a *private* league (this one) is: call ESPN's internal
v3 endpoint (`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{year}/segments/0/leagues/{leagueId}`,
or legacy `fantasy.espn.com/apis/v3/...`) with the `SWID` and `espn_s2` values sent as
cookies on the request. This must happen server-side (same CORS reasoning as Yahoo, plus
the cookies must never reach client-side JS) — extends our existing `/api` serverless
proxy pattern rather than requiring a new architecture.
**Decision: build a shared provider interface** (`getLeagueInfo`, `getRoster`,
`getMatchup`, `getDraftResults`, `getAvailablePlayers`, etc.) with two backend
implementations — `api/providers/yahoo.ts` and `api/providers/espn.ts` — so the
scoring/recommendation engine in `shared/` never needs to know which platform a team
came from. Mirrors the pattern already seen in the Kalshi/Polymarket skills (shared
`search_markets`/`get_todays_events` interface over two different backends).

## Architecture (decided, do not re-litigate without a real reason)
- Static frontend (plain HTML/CSS/JS, no framework) + a small number of Vercel
  serverless functions under `/api` (Node/TypeScript) — NOT a full Next.js app, NOT a
  literal zero-backend single file. The serverless functions exist specifically because
  Yahoo's Fantasy Sports API does not support direct browser CORS calls.
- Persistence: localStorage/IndexedDB in the browser. Nothing resets on refresh.
- Data sources: free/public only. We explicitly do NOT scrape PFF grades or FantasyPros
  premium rankings/ECR — those are paywalled/proprietary and scraping them client-side
  in a publicly deployed, view-source-able site is a real ToS/legal exposure. Use
  nflverse/nflfastR-style free data, Sleeper's public read API, ESPN public JSON (same
  caution as any undocumented endpoint — may break, not officially sanctioned, use with
  a fallback), Open-Meteo (weather, free), The Odds API (user's own free-tier key),
  Kalshi + Polymarket public market APIs (read-only, official, free), RSS/Google News
  for legitimate headline syndication.
- Kalshi/Polymarket usage boundary: implied probabilities are surfaced as a clearly
  labeled data signal ("Market-implied win probability: 63%") feeding the scoring model
  — never as disguised/hidden "picks" or real-money trade recommendations. See
  ISSUE_LOG.md 2026-08-03 for the full reasoning.
- Data refresh cadence: hourly automatic during the season, plus manual refresh.

## Skills installed (`.agents/skills/`, via machina-sports/sports-skills)
`nfl-data`, `betting`, `markets`, `kalshi` — read-only data-fetch skills, not
trade-execution tools.

## Reference implementation being mined for algorithms (not run as a live service)
https://github.com/derekrbreese/fantasy-football-mcp-public (MIT) — Python MCP server.
DECISION (2026-08-03): port the useful algorithms into our own TypeScript serverless
functions rather than standing up a second Python backend — keeps this one Vercel
project instead of two services to deploy/maintain, and matches the architecture above.
Specifically worth porting:
- VORP / position-normalization logic (`position_normalizer.py`, 281 LOC)
- Lineup optimizer structure (`lineup_optimizer.py`, 767 LOC)
- Matchup analyzer approach (`matchup_analyzer.py`, 267 LOC)
- "Enhancement layer" pattern: blend stale season projections with last-1-3-week actual
  performance (60/40 or 70/30 confidence-weighted), flag BREAKOUT_CANDIDATE /
  TRENDING_UP / DECLINING_ROLE / HIGH_CEILING / CONSISTENT
Do NOT reuse any credentials/tokens found in that repo (it contains a `.yahoo_token.json`
— irrelevant to us, we use only the user's own Yahoo Developer App credentials).

## Lessons pulled from external case study (adamrubinsky.com "Building FantasyAgent",
2026-08-03) — cherry-picked, we are NOT switching stacks to match this post
- **Yahoo OAuth is genuinely hostile**: outdated docs, silent token-refresh failures,
  slow/opaque app-approval process. The author gave up on Yahoo entirely and used
  Sleeper instead. We can't do that (the user's real league is on Yahoo), but we should
  budget real time for OAuth pain and build a manual-fallback path (paste/import league
  state) so a live-draft-night failure in Yahoo's API doesn't leave the user with
  nothing. TODO: build this fallback.
- **Cross-source player ID mismatch is a real, recurring problem** (Sleeper ID vs.
  FantasyPros ID vs. Yahoo ID for the same player; worse, name collisions like two
  "Josh Allen"s at different positions). TODO: build a canonical player-identity
  crosswalk (match on name + team + position, with explicit disambiguation) before
  wiring multiple data sources together. This is a top-priority module — get it wrong
  and every downstream stat is silently attached to the wrong player.
- **Draft-night latency matters.** Their target was recommendations within 15s for
  snake drafts; naive sequential analysis took 15–20s, and parallelizing the scoring
  tiers got it to 3–5s. Our four scoring tiers (Projections/Efficiency/Contextual/Risk)
  should likewise run concurrently, not sequentially, with aggressive caching (e.g.
  rankings cached ~30 min) and graceful fallback to last-known-good cached data if a
  live source is slow or down during a draft.
- **Documentation-as-infrastructure for AI-assisted dev is exactly what this file, plus
  ACTION_LOG.md and ISSUE_LOG.md, are for** — validated, keep maintaining these every
  session, not just at the end.

## Phase 2 — Weekly Lineup Engine: confirmed algorithm (football-scoped only; user
supplied a generic multi-sport template, we use only the football branch)
1. Inputs needed each scoring period: roster, that week's slate/schedule, player
   projections — pulled from Yahoo via our `/api` proxy; if Yahoo is unavailable,
   fall back to asking the user to paste roster + starting slots (ties into the
   Yahoo-resilience fallback above).
2. Supplementary context, provider-independent: schedule/opponent data (`nfl-data`
   skill), official injury/lineup reports (fetch the official report directly, not a
   scrape of a paywalled aggregator), Reddit r/fantasyfootball via Reddit's official
   API for late-breaking inactives (official API use, not scraping — same legitimacy
   tier as our other "official API" sources).
3. Roster slots read from the league's actual Yahoo config, not hardcoded — for
   standard football that's QB, RB, WR, TE, FLEX (RB/WR/TE), K, DEF, but pull the
   real slot counts/eligibility from the league.
4. Slotting algorithm: for each slot, rank eligible players by projection, assign the
   highest-projection player not already used; FLEX takes the best remaining
   FLEX-eligible player. Never start a player on bye or ruled OUT/inactive that week.
5. Output: a table of slot / player / opponent / projection, then the bench, then an
   explicit call-out of the closest projection-gap decisions so the manager can weigh
   matchup/role/schedule feel themselves — surface judgment calls, never hide them.
   This matches our existing "AI reasoning visible" decision for Phase 1 (confidence
   breakdown + plain-English reasoning bullets) — same philosophy, applied weekly.
This is Phase 2 scope (season app) — queued, not built yet; we're still finishing
Phase 1 scaffolding first per the user's own prioritization.

## Open questions (blocking full wiring, not blocking scaffolding)
Yahoo league (865803):
1. Number of teams in the league
2. Scoring quirks beyond PPR
3. Exact draft date, number of rounds / roster spots

ESPN league (647918841) — draft upcoming, PPR, redraft (confirmed 2026-08-03):
4. Number of teams in the ESPN league
5. Scoring quirks beyond PPR
6. Exact draft date, number of rounds / roster spots
7. Draft type — snake or auction? (not yet asked for this league specifically)

## Repo already had a README.md on GitHub before this session touched it
`origin/main` (https://github.com/gloconllc/ffl-26) already contained one commit
("Create README.md") with a detailed README the user (or an earlier session) wrote.
Reconciled our cloud working copy onto that real history via `git fetch` + `git
checkout -B main origin/main` rather than keeping our separately-initialized history —
avoids an unrelated-history merge mess later. Key things pulled from that README that
we're adopting rather than re-deciding:
- Yahoo app OAuth Client Type: **Public Client** (no client secret at all, PKCE-only).
  Doesn't remove the need for our `/api` serverless proxy — Yahoo's token endpoint still
  needs to be called from somewhere with permissive CORS/server context — but it does
  mean the proxy never needs to store a client secret, only forward the PKCE exchange.
- Local dev redirect URI: `https://127.0.0.1/callback`. **Implication:** real OAuth
  round-trip testing can't happen purely inside this cloud sandbox (no browser here) —
  it needs to happen either on the user's own machine (local dev server) or against a
  deployed Vercel URL with its own registered redirect URI. Note this as a testing
  constraint, not a blocker to writing the code.
- Repo structure the README already proposes — adopting this over what we'd started
  with, and adding `/api` (needed for the Yahoo CORS problem, not in the original
  README) and `/docs` (our cross-session continuity trio):
```
FFL_26/
├── README.md
├── draft-app/            (Phase 1: draft-app.html, styles.css, app.js)
├── season-app/           (Phase 2: season-app.html, styles.css, app.js)
├── shared/               (yahoo-auth.js, scoring-engine.js, preference-engine.js,
│                          data-sources.js — used by both phases)
├── api/                  (Vercel serverless functions — Yahoo OAuth token exchange
│                          proxy, Yahoo API read proxy; not in the original README,
│                          added because Yahoo's API has no browser CORS support)
├── docs/                 (CONTEXT.md, ACTION_LOG.md, ISSUE_LOG.md)
├── .agents/skills/       (installed sports-skills: nfl-data, betting, markets, kalshi)
└── vercel.json
```

## Local machine sync (device "anad0111-local" connected 2026-08-03)
User's Mac has `/Users/johnpicou/Documents/GitHub/ffl-26` already cloned from the same
GitHub repo and wants it treated as the main folder. Because the local device bridge
has no network access (no git push/pull/npm/pip from there) and this cloud sandbox does,
the actual build keeps happening here — the sync mechanism is normal git, not manual
file copying: commit + push from the cloud workspace (with the user's go-ahead), then
the user runs `git pull` on their Mac (needs their own network, so it's on their side)
to bring the local clone current. **DECIDED 2026-08-03: user gave blanket approval —
commit and push to `gloconllc/ffl-26` as we go, no need to ask before each push.** The
user pulls on their Mac whenever they want the latest.
