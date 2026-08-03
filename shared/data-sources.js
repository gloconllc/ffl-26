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

export const API = {
  yahooToken: "/api/yahoo/token",
  yahooProxy: "/api/yahoo/proxy",
  espnLeague: "/api/espn/league",
};
