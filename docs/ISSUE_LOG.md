# ISSUE_LOG.md — problems hit, decisions made to resolve them, and why

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
disguised framing, no "recommended parlay." Proposed to the user 2026-08-03; awaiting
explicit confirmation but proceeding on this basis since it's the only version of the
feature that gets built either way.

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
