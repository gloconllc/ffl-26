// Non-secret configuration shared by both apps. Real credentials never live here —
// see docs/CONTEXT.md "Credentials — where they actually live". League IDs are not
// sensitive on their own (our server-side proxies still require real auth), so they're
// fine to keep in committed client code.

export const LEAGUES = {
  yahoo: {
    leagueId: "865803",
    provider: "yahoo",
    scoring: "PPR",
    draftType: "snake",
  },
  espn: {
    leagueId: "647918841",
    provider: "espn",
    season: 2026,
    scoring: "PPR",
    isKeeper: false, // redraft, confirmed 2026-08-03
  },
};

// Public, unauthenticated market-data API — safe to call directly from the browser.
// See docs/DATA_SOURCES.md. If this turns out NOT to send permissive CORS headers
// when we actually test it, route it through /api instead like Yahoo/ESPN.
export const KALSHI_BASE = "https://external-api.kalshi.com/trade-api/v2";

// A reasonably standard redraft roster — until we read a league's real settings from
// Yahoo/ESPN (see docs/CONTEXT.md open questions), this is the default used for
// practice-mode setup. FLEX approximated as RB/WR/TE eligible.
export const DEFAULT_ROSTER_SLOTS = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 2, eligiblePositions: ["RB"] },
  { slot: "WR", count: 2, eligiblePositions: ["WR"] },
  { slot: "TE", count: 1, eligiblePositions: ["TE"] },
  { slot: "FLEX", count: 1, eligiblePositions: ["RB", "WR", "TE"] },
  { slot: "K", count: 1, eligiblePositions: ["K"] },
  { slot: "DEF", count: 1, eligiblePositions: ["DEF"] },
  { slot: "BN", count: 6, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];

export const API = {
  yahooToken: "/api/yahoo/token",
  yahooProxy: "/api/yahoo/proxy",
  espnLeague: "/api/espn/league",
};
