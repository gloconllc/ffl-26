# ISSUE_LOG.md — problems hit, decisions made to resolve them, and why

## 2026-08-03 — Cloud sandbox has no GitHub push credentials

**Issue:** First real commit made locally (`ea4df40`), but `git push -u origin main`
failed: `fatal: could not read Username for 'https://github.com': terminal prompts
disabled`. This cloud workspace has never been given GitHub auth.

**Why this needed a decision:** The user gave blanket approval to commit+push as we go,
but that requires actual credentials in this sandbox — there's no interactive login
available here. The user's Mac already has working git auth (they cloned successfully),
but the local device bridge (`device_bash`) has no network access at all, so it can't
push either, regardless of credentials — a push can only happen from this cloud
sandbox's Bash (has network, needs credentials) or from the user's own real terminal
outside any of our tool bridges (has network and credentials, but requires their manual
action each time).

**Resolution:** RESOLVED 2026-08-03 — user provided a classic PAT (`ghp_...`, not
fine-grained, so likely broader than single-repo scope — their choice, flagged once).
Pushed by passing it inline on the `git push https://<token>@github.com/...` URL for a
single command, never via `git config` (not modified, per standing constraint) and
never written to any file. All four pending commits landed on `origin/main`
(`f15f005..9651654`). Future pushes repeat the same inline-URL approach each time —
nothing persists the token between commands.

## 2026-08-03 — Kalshi "parlay picks" framing

**Issue:** User asked to "put kalshi parlays as picks subtly on the app."

**Why this needed a decision rather than just building it:** Kalshi is a CFTC-regulated
real-money event-contract exchange. Packaging Kalshi contract combinations as "picks"
styled like fantasy draft picks, and doing so *subtly* (i.e. not clearly disclosed),
would turn a fantasy stats tool into an undisclosed real-money gambling recommendation
feature — a different regulatory/ethical category than displaying informational
probabilities, and a dark-pattern concern regardless of regulation (anyone using this
league tool should be able to tell, at a glance, when a feature involves real-money
markets).

**Resolution:** Kalshi (and Polymarket) implied probabilities are pulled in as a
clearly labeled contextual data signal only (e.g. "Market-implied win probability:
63%"), feeding the existing scoring tiers alongside Vegas lines. No buy/sell action, no
disguised framing, no "recommended parlay." Proposed to the user 2026-08-03.

**Refined UI design (confirmed 2026-08-03):** small "K" badge/icon on a player or team
card. Hover/tap reveals current Kalshi price, implied probability, and trend vs. the
previous snapshot. A user can click the icon to add/remove that event from a *separate*
combos/parlay builder module — that builder is explicitly not part of the fantasy
roster/draft engine, just a companion view. Public market data pulled read-only, no
auth, from `https://external-api.kalshi.com/trade-api/v2` (same endpoint the installed
`kalshi` skill wraps). This keeps the signal visible and clearly labeled (addressing the
original "subtle" framing concern) while still separating real-money market data from
fantasy roster decisions.

**Implementation note:** the `.agents/skills/{nfl-data,betting,markets,kalshi}` skills
are dev-time references for use *during this Claude session* while building (CLI/Python
via the `sports-skills` package) — they are not a runtime dependency of the deployed
app. The actual Vercel app is static HTML/CSS/JS + TypeScript serverless functions, so
production code calls these same public HTTP APIs directly in TypeScript, not through
the Python package.

## 2026-08-03 — Zero-backend static file can't actually reach Yahoo

**Issue:** Original spec called for a literal single static HTML file with no backend
at all, using pure client-side `fetch()` (with PKCE for Yahoo OAuth).

**Why this needed a decision:** Yahoo's Fantasy Sports API does not send CORS headers
permitting arbitrary browser origins, so a pure-browser OAuth token exchange and
authenticated API reads will fail from client-side JS alone, regardless of PKCE.

**Resolution:** Added a small number (2–3) of Vercel serverless functions under `/api`
to proxy just the Yahoo OAuth token exchange and authenticated reads. Everything else
stays static/client-side. Confirmed with user via clarifying question — chose this
option explicitly over "switch to Next.js" and over "stay 100% static, accept Yahoo may
not fully work."

## 2026-08-03 — Scraping paywalled sources (PFF, FantasyPros premium)

**Issue:** Original spec named PFF grades and FantasyPros premium/ECR rankings as
scrape targets via public CORS proxies.

**Why this needed a decision:** Both are paywalled/proprietary. Scraping them
client-side inside a publicly deployed, view-source-able static site is a materially
larger ToS/legal exposure than a private script would be — anyone can see exactly how
and what is being scraped.

**Resolution:** Skip direct scraping of PFF/FantasyPros. Use free/public equivalents
(nflverse/nflfastR-style data, Sleeper public API, ESPN public JSON with the standard
"may change without notice" caveat, Open-Meteo, The Odds API with the user's own key,
Kalshi/Polymarket official public APIs, RSS for news). Confirmed with user via
clarifying question.

## Template for future entries
```
## YYYY-MM-DD — short title

**Issue:** what went wrong or what needed a call
**Why this needed a decision:** the actual tradeoff, not just "it came up"
**Resolution:** what we did, and whether the user explicitly confirmed it
```
