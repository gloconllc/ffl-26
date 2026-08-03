# ISSUE_LOG.md — problems hit, decisions made to resolve them, and why

## 2026-08-03 — Yahoo and ESPN not connecting on the deployed app

**Issue:** User reports neither Yahoo nor ESPN connects on the live Vercel deployment.

**Root causes (three, found by inspection — not yet confirmed live since this
sandbox can't reach either provider, see docs/DATA_SOURCES.md):**
1. `.env.local` (`YAHOO_CLIENT_ID`, `ESPN_SWID`, `ESPN_S2`) is git-ignored by design —
   it only ever existed in this cloud sandbox, never pushed to GitHub, never present
   on the user's Mac, and **never set on the actual Vercel project**. Every `/api`
   function that reads these from `process.env` will throw "not set" on Vercel right
   now — this alone would break both Yahoo and ESPN.
2. Yahoo specifically: the OAuth redirect URI is computed as
   `${location.origin}/callback` (see `shared/yahoo-auth.js`), but (a) no page/rewrite
   existed at `/callback` at all — Yahoo redirecting back would 404 — and (b) even
   with that fixed, the Yahoo Developer App only has `https://127.0.0.1/callback`
   registered (per README.md), not the real deployed domain
   (`https://ffl-26.vercel.app/callback`), so Yahoo would reject the request outright.
3. ESPN: purely the missing-env-var issue (1) — no separate bug found.

**Resolution:**
- Fixed (1a): added `{ "source": "/callback", "destination": "/draft-app/draft-app.html" }`
  to `vercel.json` — this was already anticipated in README.md's "Future production
  setup" section, just not wired up yet.
- Still needs the user to do two things I can't do remotely without more access:
  (a) add `YAHOO_CLIENT_ID`, `ESPN_SWID`, `ESPN_S2` to the Vercel project's
  Environment Variables (Settings → Environment Variables) and redeploy — OR give a
  scoped Vercel token so this can be set programmatically, same pattern as the GitHub
  PAT; (b) add `https://ffl-26.vercel.app/callback` as a second registered redirect
  URI in the Yahoo Developer App console (developer.yahoo.com/apps) — this requires
  their Yahoo login, can't be done by me either way.

## 2026-08-03 — Deployed page was completely unstyled ("looks horrible")

**Issue:** User deployed and the page rendered as plain unstyled HTML — no dark theme,
no card layout, tabs run together as plain text, nothing interactive (theme toggle,
tab switching, connect buttons all inert). This was NOT "the design hasn't been built
yet" — the CSS and JS were both real and already written; they just never loaded in
the browser.

**Root cause:** `vercel.json` rewrites `/` to `/draft-app/draft-app.html`, but a
rewrite changes what content is served at a URL without changing the URL shown in the
browser. `draft-app.html` referenced its CSS/JS with relative paths (`href="styles.css"`,
`src="app.js"`), which the browser resolves relative to the *visible* URL (`/`), not the
file's real location — so it was actually requesting `/styles.css` and `/app.js` (both
404) instead of `/draft-app/styles.css` and `/draft-app/app.js`. No styling, no
JavaScript at all ran.

**Resolution:** Changed both references in `draft-app/draft-app.html` to root-absolute
paths (`/draft-app/styles.css`, `/draft-app/app.js`), which resolve correctly
regardless of what URL is showing. `app.js`'s own internal `../shared/...` imports are
relative to the *module's* URL once it loads, not the page URL, so those were already
fine and didn't need changing. Lesson for anything added later: any page reached via a
rewrite must use absolute (leading-slash) asset paths, not relative ones.

## 2026-08-03 — Vercel deploy failed: "No Output Directory named 'public' found"

**Issue:** User tried deploying (via Vercel's dashboard/GitHub integration) and hit:
"No Output Directory named 'public' found after the Build completed."

**Why this happened:** `package.json` had a `"build"` script (`tsc --noEmit -p
api/tsconfig.json`) left over from earlier type-checking. Vercel auto-detects any
`build` script as its Build Command; `tsc --noEmit` deliberately emits nothing, so
after "running the build," Vercel looked for an output directory (defaulting to
`public` since a build step existed) and found nothing there — we don't have a
`public` folder at all (renamed to `draft-app/`/`season-app/`/`shared/` earlier).

**Resolution:** Renamed the script to `"typecheck"` (still runs the same command, just
never auto-invoked by Vercel as a build step) and added `"framework": null` to
`vercel.json` to make the zero-config static + serverless-functions intent explicit.
This is a static site with API functions, not a framework project — it should never
have a "build" step or an expected output directory at all. Verified `npm run
typecheck` and `npm run selftest` both still work after the rename.

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
