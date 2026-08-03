# FFL_26

Personal fantasy football intelligence app for Yahoo Fantasy Football, designed for local development first and deployment to Vercel later.

## Overview

FFL_26 is intended to support two major workflows:

- Draft decision support, including rankings, value signals, roster construction, and pick recommendations.
- In-season management, including lineup decisions, waiver analysis, trade evaluation, and daily intelligence updates.

The application connects to Yahoo Fantasy Sports for league-specific data and uses additional public data sources for projections, injuries, weather, news, and contextual signals.

## Core goals

- Connect securely to a Yahoo Fantasy Football league.
- Build a draft assistant before building the full season management experience.
- Blend statistical recommendations with personal preferences and user overrides.
- Recalculate recommendations after every draft pick, lineup decision, trade review, or waiver move.
- Keep the interface simple, colorful, fast, and easy to use while the underlying decision engine remains advanced.

## Planned product phases

### Phase 1: Draft App

Primary features:

- Yahoo league connection and league settings sync.
- Draft board with live pick tracking.
- Available player rankings and tiering.
- Best pick recommendation engine.
- Personal preference weighting.
- Confidence scores and reasoning summaries.
- ADP value alerts and roster construction guidance.

### Phase 2: Season App

Primary features:

- Weekly lineup optimization.
- Trade analyzer.
- Waiver wire and free agent recommendations.
- Injury, weather, and news intelligence.
- Matchup analysis.
- Ongoing model evaluation and adjustment.

## Tech approach

Initial build target:

- Static frontend app suitable for Vercel deployment.
- HTML, CSS, and JavaScript or a lightweight frontend framework.
- Yahoo Fantasy Sports OAuth connection for private league access.
- Modular scoring engine for draft and in-season decisions.
- Scraped or fetched public-source data for supplemental signals.

## Yahoo Developer setup

Create a Yahoo application with settings similar to the following:

- **Application Name:** `FFL_26`
- **Description:** `Personal fantasy football app`
- **Homepage URL:** `http://localhost`
- **Redirect URI:** `https://127.0.0.1/callback`
- **OAuth Client Type:** `Public Client`
- **API Permissions:** `Fantasy Sports`
- **OpenID Connect Permissions:** `Profile`
- **Optional OpenID Connect Permission:** `Email` only if the app needs the Yahoo email address

## Why Public Client

A browser-based app or single-page app should use a public client pattern because a frontend-only app cannot safely protect a client secret. If the project later adds a secure backend that handles token exchange and secret storage, the OAuth setup can be revisited.

## Local development

Use a local callback route that exactly matches the Yahoo app configuration:

- `https://127.0.0.1/callback`

Important:

- The redirect URI used in code must exactly match the URI registered in Yahoo.
- Keep the path consistent, including protocol, host, path, port, and trailing slash behavior.

## Future production setup

After the app is deployed to Vercel, add a production redirect URI such as:

- `https://your-project-name.vercel.app/callback`

Register local and production redirect URIs separately.

## Suggested repository structure

```text
FFL_26/
├── README.md
├── draft-app/
│   ├── draft-app.html
│   ├── styles.css
│   └── app.js
├── season-app/
│   ├── season-app.html
│   ├── styles.css
│   └── app.js
├── shared/
│   ├── yahoo-auth.js
│   ├── scoring-engine.js
│   ├── preference-engine.js
│   └── data-sources.js
└── vercel.json
```

## Decision engine design principles

The recommendation engine should consider more than standard box score stats. Planned inputs include:

- Player projections.
- Historical fantasy production.
- Advanced opportunity and efficiency metrics.
- Opponent matchup quality.
- Coaching tendencies.
- Injury status.
- Weather.
- Vegas totals and line movement.
- Local news and off-field developments.
- Trade, role, and depth chart changes.
- Personal user preferences and overrides.

## Product experience principles

- Keep the interface intuitive.
- Make recommendations transparent.
- Show confidence levels clearly.
- Allow personal overrides without breaking the model.
- Rebalance probabilities after each user decision.
- Preserve a favorable strategic path even after non-model picks.

## Immediate next steps

1. Finish Yahoo app creation.
2. Save the Client ID.
3. Build the local OAuth callback flow.
4. Confirm league connection works.
5. Define draft app requirements in detail.
6. Build the draft app first.
7. Add the season app after the draft workflow is stable.
8. Push the project to GitHub.
9. Deploy to Vercel.

## Notes

This project should be built in a way that makes model logic modular and easy to expand over time. New data sources, weighting factors, and decision rules should be addable without restructuring the full app.

## Local development (added as scaffolding landed)

```bash
npm install
npx vercel dev   # serves draft-app/, season-app/, and /api together locally
```

Required environment variables (put in `.env.local`, already git-ignored — never commit real values):

- `YAHOO_CLIENT_ID` — from the Yahoo Developer App (Public Client, no secret exists)
- `ESPN_SWID`, `ESPN_S2` — the account owner's own ESPN session cookies (see `docs/DATA_SOURCES.md` for how these are used and why they're required for a private ESPN league)

See `docs/CONTEXT.md`, `docs/ACTION_LOG.md`, `docs/ISSUE_LOG.md`, and `docs/DATA_SOURCES.md` for the full running history of decisions, what's built vs. stubbed, and exact endpoints — read `CONTEXT.md` first in any new session before making changes.

## Second league (added 2026-08-03)

This platform now supports two leagues on two platforms: Yahoo (league 865803) and ESPN (league 647918841), both redraft/PPR with upcoming drafts. The scoring/recommendation engine is provider-agnostic (`api/_lib/types.ts`) so it doesn't matter which platform a team's data comes from.
