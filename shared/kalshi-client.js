// Kalshi market-data client (browser side).
//
// BOUNDARY — read this before extending (docs/ISSUE_LOG.md, 2026-08-03):
// Kalshi data is surfaced as a CLEARLY LABELED market signal and nothing else. It does
// not feed the fantasy scoring engine, it is never presented as a "pick," a parlay
// recommendation, or a suggested wager, and this app never touches Kalshi's
// trading/portfolio endpoints. Prices here are public market data — the same class of
// information as a Vegas line printed in a newspaper — shown so the user can see what a
// real-money market thinks and draw their own conclusion.
//
// Everything in here fails soft: if Kalshi is unreachable, badges simply don't render
// and the Markets tab says so honestly. Nothing about the draft depends on it.
import { saveJSON, loadJSON } from "./storage.js";

const SNAPSHOT_KEY = "kalshi_snapshot";

/** Abbreviation → the strings a Kalshi market title might actually use. Kalshi writes
 * titles in plain English ("Will the Bills win...?", "Buffalo Bills"), while our player
 * data uses nflverse abbreviations, so matching needs both the city and the nickname.
 * LA/LAC/LV/WAS etc. are the ones that most often go wrong, so they're spelled out. */
const NFL_TEAMS = {
  ARI: { city: "Arizona", nickname: "Cardinals" },
  ATL: { city: "Atlanta", nickname: "Falcons" },
  BAL: { city: "Baltimore", nickname: "Ravens" },
  BUF: { city: "Buffalo", nickname: "Bills" },
  CAR: { city: "Carolina", nickname: "Panthers" },
  CHI: { city: "Chicago", nickname: "Bears" },
  CIN: { city: "Cincinnati", nickname: "Bengals" },
  CLE: { city: "Cleveland", nickname: "Browns" },
  DAL: { city: "Dallas", nickname: "Cowboys" },
  DEN: { city: "Denver", nickname: "Broncos" },
  DET: { city: "Detroit", nickname: "Lions" },
  GB: { city: "Green Bay", nickname: "Packers" },
  HOU: { city: "Houston", nickname: "Texans" },
  IND: { city: "Indianapolis", nickname: "Colts" },
  JAX: { city: "Jacksonville", nickname: "Jaguars" },
  KC: { city: "Kansas City", nickname: "Chiefs" },
  LA: { city: "Los Angeles", nickname: "Rams" },
  LAC: { city: "Los Angeles", nickname: "Chargers" },
  LV: { city: "Las Vegas", nickname: "Raiders" },
  MIA: { city: "Miami", nickname: "Dolphins" },
  MIN: { city: "Minnesota", nickname: "Vikings" },
  NE: { city: "New England", nickname: "Patriots" },
  NO: { city: "New Orleans", nickname: "Saints" },
  NYG: { city: "New York", nickname: "Giants" },
  NYJ: { city: "New York", nickname: "Jets" },
  PHI: { city: "Philadelphia", nickname: "Eagles" },
  PIT: { city: "Pittsburgh", nickname: "Steelers" },
  SEA: { city: "Seattle", nickname: "Seahawks" },
  SF: { city: "San Francisco", nickname: "49ers" },
  TB: { city: "Tampa Bay", nickname: "Buccaneers" },
  TEN: { city: "Tennessee", nickname: "Titans" },
  WAS: { city: "Washington", nickname: "Commanders" },
};

export function teamLabel(abbr) {
  const t = NFL_TEAMS[abbr];
  return t ? `${t.city} ${t.nickname}` : abbr || "";
}

let cache = null; // { fetchedAt, markets }
let inFlight = null;
let lastError = null;

export function getLastKalshiError() {
  return lastError;
}

/** Fetch NFL markets through our own serverless proxy. Cached in memory for the page's
 * lifetime (market prices move, but not fast enough to justify a call per render), and
 * de-duplicated so ten badges rendering at once make one request, not ten. */
export async function fetchNflMarkets({ force = false } = {}) {
  if (cache && !force) return cache;
  if (inFlight && !force) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch("/api/kalshi/markets?series=KXNFL&limit=200");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      const markets = Array.isArray(data.markets) ? data.markets : [];
      cache = { fetchedAt: data.fetchedAt || new Date().toISOString(), markets };
      lastError = null;
      recordSnapshot(markets);
      return cache;
    } catch (err) {
      lastError = err && err.message ? err.message : String(err);
      cache = { fetchedAt: null, markets: [] };
      return cache;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Persist the current price per ticker so the next load can show a real trend arrow
 * rather than inventing one. Deliberately keyed by ticker and capped, so this can't
 * grow without bound in localStorage. */
function recordSnapshot(markets) {
  try {
    const prev = loadJSON(SNAPSHOT_KEY, {});
    const next = {};
    for (const m of markets.slice(0, 200)) {
      if (!m.ticker || m.impliedProbability == null) continue;
      next[m.ticker] = {
        p: m.impliedProbability,
        // Keep the PREVIOUS price around as `was`, so a trend survives this write.
        was: prev[m.ticker] && prev[m.ticker].p != null ? prev[m.ticker].p : null,
        t: Date.now(),
      };
    }
    saveJSON(SNAPSHOT_KEY, next);
  } catch {
    // A storage failure must never break market display — trend is a nicety.
  }
}

/** Change in implied probability vs. the previous page load, in percentage points.
 * Returns null when there's no prior snapshot — an unknown trend is shown as unknown,
 * never as "flat." */
export function trendFor(ticker) {
  try {
    const snap = loadJSON(SNAPSHOT_KEY, {});
    const entry = snap[ticker];
    if (!entry || entry.was == null || entry.p == null) return null;
    const delta = entry.p - entry.was;
    return delta === 0 ? null : delta;
  } catch {
    return null;
  }
}

function marketMentionsTeam(market, abbr) {
  const team = NFL_TEAMS[abbr];
  if (!team) return false;
  const haystack = `${market.eventTitle || ""} ${market.title || ""} ${market.subtitle || ""}`.toLowerCase();
  if (!haystack.trim()) return false;
  // Match on the nickname first — it's unique across the league, whereas cities are not
  // ("Los Angeles" and "New York" each cover two franchises, so a city-only match would
  // happily attach a Chargers market to a Rams player).
  return haystack.includes(team.nickname.toLowerCase());
}

/** The single most relevant open market for a team, or null. "Most relevant" = the one
 * with the most volume, since a thinly traded contract's price is closer to noise. */
export function marketForTeam(abbr) {
  if (!cache || !cache.markets.length || !abbr) return null;
  const matches = cache.markets.filter((m) => marketMentionsTeam(m, abbr));
  if (!matches.length) return null;
  return matches.reduce((best, m) => ((m.volume ?? 0) > (best.volume ?? 0) ? m : best), matches[0]);
}

export function getCachedMarkets() {
  return cache ? cache.markets : [];
}

export function getMarketsFetchedAt() {
  return cache ? cache.fetchedAt : null;
}
