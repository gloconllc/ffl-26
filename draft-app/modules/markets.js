// Markets tab — live Kalshi NFL prediction-market prices.
//
// This is deliberately a READ-ONLY, clearly-labeled information surface. Market prices
// are shown as implied probability with the source named, they do not feed the fantasy
// scoring engine, and nothing here is framed as a pick, a parlay, or a recommendation
// to trade. That boundary was set deliberately (docs/ISSUE_LOG.md) and should not be
// quietly relaxed by a future change.
import { fetchNflMarkets, getCachedMarkets, getMarketsFetchedAt, getLastKalshiError, trendFor } from "../../shared/kalshi-client.js";
import { safe, withBusy, escapeHtml, logDebug } from "./dom-utils.js";
import { notifyAppChange } from "../../shared/store.js";

function marketCardHtml(m) {
  const pct = m.impliedProbability == null ? null : Math.round(m.impliedProbability);
  const trend = m.ticker ? trendFor(m.ticker) : null;
  const trendHtml =
    trend == null
      ? ""
      : `<span class="${trend > 0 ? "k-up" : "k-down"}">${trend > 0 ? "▲" : "▼"} ${Math.abs(Math.round(trend))} pts</span>`;

  return `
    <article class="market-card">
      <div class="market-title">${escapeHtml(m.title)}</div>
      ${m.eventTitle && m.eventTitle !== m.title ? `<div class="market-event">${escapeHtml(m.eventTitle)}</div>` : ""}
      <div class="market-prob">
        <span class="market-prob-value">${pct == null ? "—" : `${pct}%`}</span>
        <span class="market-prob-label">implied probability ${trendHtml}</span>
      </div>
      <div class="market-bar"><div class="market-bar-fill" style="width:${pct == null ? 0 : pct}%"></div></div>
      <div class="market-meta">
        ${m.volume != null ? `<span>vol ${m.volume.toLocaleString()}</span>` : ""}
        ${m.yesBid != null ? `<span>bid ${m.yesBid}¢</span>` : ""}
        ${m.yesAsk != null ? `<span>ask ${m.yesAsk}¢</span>` : ""}
      </div>
    </article>`;
}

export function renderMarkets() {
  const el = document.getElementById("markets-content");
  const statusEl = document.getElementById("markets-status");
  if (!el) return;

  const markets = getCachedMarkets();
  const err = getLastKalshiError();
  const fetchedAt = getMarketsFetchedAt();

  if (statusEl) {
    statusEl.textContent = fetchedAt
      ? `updated ${new Date(fetchedAt).toLocaleTimeString()}`
      : err
        ? "unavailable"
        : "loading…";
  }

  if (err && !markets.length) {
    // Honest failure, with the actual reason — never a blank panel that looks like
    // there simply are no markets today.
    el.innerHTML = `
      <p class="hint" style="margin-top:0">Couldn't reach Kalshi: ${escapeHtml(err)}</p>
      <p class="hint">This is a live external service and it fails soft on purpose — nothing else in the app depends on it, and your draft is unaffected. Try Refresh, or check again closer to kickoff.</p>`;
    return;
  }

  if (!markets.length) {
    el.innerHTML = `<p class="hint">No open NFL markets returned right now. Kalshi lists game markets closer to kickoff, so this fills in as the week approaches.</p>`;
    return;
  }

  el.innerHTML = `<div class="market-grid">${markets.slice(0, 36).map(marketCardHtml).join("")}</div>`;
}

/** Kick off the initial fetch and wire the refresh button. Never awaited by boot —
 * a slow or dead market API must not delay the draft UI by even a frame. */
export function initMarkets() {
  const btn = document.getElementById("markets-refresh-btn");
  if (btn) {
    btn.addEventListener(
      "click",
      safe(
        () =>
          withBusy(btn, async () => {
            await fetchNflMarkets({ force: true });
            // Badges appear across the cheat sheet and player table too, so a refresh
            // re-renders everything rather than only this tab.
            notifyAppChange();
          }),
        "refresh markets"
      )
    );
  }

  fetchNflMarkets()
    .then((res) => {
      logDebug("Kalshi markets loaded", {
        count: res.markets.length,
        fetchedAt: res.fetchedAt,
        error: getLastKalshiError(),
      });
      notifyAppChange();
    })
    .catch(() => {
      // fetchNflMarkets already swallows and records its own errors; this is just a
      // belt-and-braces guard so an unexpected throw can't produce an unhandled
      // rejection banner during a draft.
    });
}
