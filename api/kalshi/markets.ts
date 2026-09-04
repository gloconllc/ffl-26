import type { VercelRequest, VercelResponse } from "@vercel/node";

// GET /api/kalshi/markets?series=KXNFL&limit=200
//
// Server-side proxy for Kalshi's PUBLIC, read-only market-data API. Two reasons this
// is a serverless function rather than a direct browser fetch:
//   1. Kalshi's CORS headers on these endpoints have never been verified from a
//      browser (docs/DATA_SOURCES.md flags this as an untested assumption) — proxying
//      makes the question moot instead of risking a silent client-side failure.
//   2. It gives one place to normalize Kalshi's response shape, so the browser client
//      never has to care whether markets arrive nested under events or flat.
//
// No authentication is used or needed. Kalshi requires signed requests ONLY for
// portfolio/orders/trading endpoints — this function deliberately touches none of
// them. This is market DATA, never trade execution. See docs/ISSUE_LOG.md: market
// prices are surfaced as a clearly labeled signal, never as disguised "picks."
const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

// Kalshi's own NFL series ticker (see .agents/skills/kalshi/references/series-tickers.md).
const DEFAULT_SERIES = "KXNFL";

// Only allow series tickers that look like Kalshi tickers, so a caller can't turn this
// proxy into an open redirect / SSRF against arbitrary paths on the Kalshi host.
const SERIES_PATTERN = /^[A-Z0-9]{2,20}$/;

type KalshiMarket = {
  ticker?: string;
  event_ticker?: string;
  title?: string;
  subtitle?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  last_price?: number;
  yes_bid?: number;
  yes_ask?: number;
  volume?: number;
  open_interest?: number;
  close_time?: string;
  status?: string;
};

type KalshiEvent = {
  event_ticker?: string;
  series_ticker?: string;
  title?: string;
  sub_title?: string;
  markets?: KalshiMarket[];
};

/** Kalshi prices are 0-100 integers read directly as an implied probability percentage
 * (last_price 20 → 20%). Not American odds, not Polymarket's 0-1 scale. Prefer the last
 * traded price; fall back to the midpoint of the yes bid/ask when a market hasn't
 * traded yet, since an untraded market still carries a real quoted probability. */
function impliedProbability(m: KalshiMarket): number | null {
  if (typeof m.last_price === "number" && m.last_price > 0) return m.last_price;
  const bid = typeof m.yes_bid === "number" ? m.yes_bid : null;
  const ask = typeof m.yes_ask === "number" ? m.yes_ask : null;
  if (bid !== null && ask !== null && (bid > 0 || ask > 0)) return Math.round((bid + ask) / 2);
  if (bid !== null && bid > 0) return bid;
  return null;
}

function normalizeMarket(m: KalshiMarket, ev?: KalshiEvent) {
  return {
    ticker: m.ticker ?? null,
    eventTicker: m.event_ticker ?? ev?.event_ticker ?? null,
    eventTitle: ev?.title ?? null,
    // Kalshi puts the human-readable contract question in different fields depending on
    // the market type — take the first that's actually populated rather than assuming.
    title: m.title || m.yes_sub_title || ev?.sub_title || ev?.title || m.ticker || "Market",
    subtitle: m.subtitle || m.yes_sub_title || ev?.sub_title || null,
    impliedProbability: impliedProbability(m),
    lastPrice: typeof m.last_price === "number" ? m.last_price : null,
    yesBid: typeof m.yes_bid === "number" ? m.yes_bid : null,
    yesAsk: typeof m.yes_ask === "number" ? m.yes_ask : null,
    volume: typeof m.volume === "number" ? m.volume : null,
    openInterest: typeof m.open_interest === "number" ? m.open_interest : null,
    closeTime: m.close_time ?? null,
    status: m.status ?? null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Use GET" });
  }

  const seriesParam = typeof req.query.series === "string" ? req.query.series : DEFAULT_SERIES;
  const series = seriesParam.toUpperCase();
  if (!SERIES_PATTERN.test(series)) {
    return res.status(400).json({ error: "Invalid ?series= (expected a Kalshi series ticker like KXNFL)" });
  }

  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 200;

  // Events-with-nested-markets gives us the game/matchup title alongside each contract,
  // which is what makes a market row readable ("Bills to win vs. Texans" rather than a
  // bare ticker). Fall back to the flat markets endpoint if that shape comes back empty.
  const eventsUrl = `${KALSHI_BASE}/events?series_ticker=${series}&status=open&with_nested_markets=true&limit=${limit}`;
  const marketsUrl = `${KALSHI_BASE}/markets?series_ticker=${series}&status=open&limit=${limit}`;

  try {
    const evRes = await fetch(eventsUrl, { headers: { Accept: "application/json" } });
    if (!evRes.ok) {
      const body = await evRes.text().catch(() => "");
      throw new Error(`Kalshi events call failed (${evRes.status}): ${body.slice(0, 200)}`);
    }
    const evData = (await evRes.json()) as { events?: KalshiEvent[] };
    const events = Array.isArray(evData.events) ? evData.events : [];

    let markets = events.flatMap((ev) =>
      (Array.isArray(ev.markets) ? ev.markets : []).map((m) => normalizeMarket(m, ev))
    );

    if (!markets.length) {
      const mRes = await fetch(marketsUrl, { headers: { Accept: "application/json" } });
      if (!mRes.ok) {
        const body = await mRes.text().catch(() => "");
        throw new Error(`Kalshi markets call failed (${mRes.status}): ${body.slice(0, 200)}`);
      }
      const mData = (await mRes.json()) as { markets?: KalshiMarket[] };
      markets = (Array.isArray(mData.markets) ? mData.markets : []).map((m) => normalizeMarket(m));
    }

    // Most-active first — a market with real volume carries a more meaningful implied
    // probability than one nobody has traded.
    markets.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

    // Cache briefly at the edge: market prices move, but not so fast that every page
    // view needs a fresh upstream call, and this keeps draft-night latency down.
    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=300");
    return res.status(200).json({
      series,
      fetchedAt: new Date().toISOString(),
      source: "Kalshi public market data (api.elections.kalshi.com), read-only, no auth",
      eventCount: events.length,
      marketCount: markets.length,
      markets: markets.slice(0, limit),
    });
  } catch (err) {
    console.error("[api/kalshi/markets]", err);
    return res.status(502).json({ error: (err as Error).message });
  }
}
