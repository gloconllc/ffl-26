// Overview — the "don't make me hop across tabs" screen. Status at a glance, the
// tiered cheat sheet, and what to do next. Deliberately works BEFORE a draft is
// started (scoring the full pool), because the cheat sheet is the thing you want open
// on a second monitor whether or not you're logging picks here.
import { getDraftState, currentPickNumber, teamSlotForPick, isMyPick, getMyRoster } from "../../shared/draft-state.js";
import { scorePlayer, buildScoringCaches } from "../../shared/scoring-engine.js";
import { escapeHtml, marketBadgeHtml } from "./dom-utils.js";
import { getCachedPlayers, getCachedTeamContext, isUsingPlaceholderData } from "./player-data.js";
import { getWeights } from "./settings.js";
import { marketForTeam, trendFor } from "../../shared/kalshi-client.js";

const CHEAT_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const PER_COLUMN = 12;

// Scoring the full ~800-player pool is the same O(n log n) work the Players tab does,
// so memoize it on the same inputs that can change the answer.
let cheatCache = null; // { key, ranked }

function rankFullPool() {
  const players = getCachedPlayers();
  if (!players || !players.length) return [];

  const state = getDraftState();
  const key = `${players.length}:${state ? state.numTeams : 10}:${JSON.stringify(getWeights())}`;
  if (cheatCache && cheatCache.key === key) return cheatCache.ranked;

  const leagueSettings = {
    numTeams: state?.numTeams || 10,
    startersPerTeamByPosition: { QB: 1, RB: 2.5, WR: 2.5, TE: 1, K: 1, DEF: 1 },
  };
  const caches = buildScoringCaches(players, leagueSettings);
  const weights = getWeights();
  const ranked = players
    .map((player) => ({
      player,
      scoreResult: scorePlayer(
        player,
        { allPlayersAtPosition: players, leagueSettings, teamContext: getCachedTeamContext() || {}, ...caches },
        weights
      ),
    }))
    .sort((a, b) => b.scoreResult.score - a.scoreResult.score);

  cheatCache = { key, ranked };
  return ranked;
}

export function clearOverviewCache() {
  cheatCache = null;
}

function draftedIdSet(state) {
  if (!state) return new Set();
  return new Set(state.picks.map((p) => p.providerPlayerId));
}

// --- KPI strip -------------------------------------------------------------------
export function renderKpis() {
  const el = document.getElementById("kpi-strip");
  if (!el) return;

  const state = getDraftState();
  const players = getCachedPlayers() || [];
  const ranked = rankFullPool();
  const drafted = draftedIdSet(state);
  const topAvailable = ranked.find((r) => !drafted.has(r.player.providerPlayerId));

  const cards = [];

  cards.push(kpi("Player pool", String(players.length), isUsingPlaceholderData() ? "placeholder data" : "real nflverse data"));

  if (state) {
    const pickNum = currentPickNumber(state);
    const { round, teamSlot } = teamSlotForPick(pickNum, state.numTeams);
    const mine = isMyPick(state);
    cards.push(
      kpi(
        "On the clock",
        mine ? "You" : `Team ${teamSlot}`,
        `pick ${pickNum} · round ${round}`,
        mine ? "kpi-live" : ""
      )
    );

    // How many picks until it's your turn again — the single number that decides
    // whether you can wait on a position or have to take it now.
    const untilMine = picksUntilMyTurn(state);
    cards.push(
      kpi("Your next pick", untilMine === 0 ? "Now" : `${untilMine} away`, untilMine === 0 ? "you're up" : "picks until your turn", "kpi-accent")
    );
    cards.push(kpi("Picks logged", String(state.picks.length), `${getMyRoster(state).length} on your roster`));
  } else {
    cards.push(kpi("Draft", "Not started", "start one in the Draft Room"));
    cards.push(kpi("Top overall", topAvailable ? topAvailable.player.name : "—", topAvailable ? `${topAvailable.player.position} · ${topAvailable.player.team}` : "", "kpi-accent"));
    cards.push(kpi("Leagues", "2", "Yahoo 865803 · ESPN 647918841"));
  }

  if (state && topAvailable) {
    cards.push(
      kpi("Best available", topAvailable.player.name, `${topAvailable.player.position} · ${topAvailable.player.team} · ${topAvailable.scoreResult.score.toFixed(0)} score`, "kpi-accent")
    );
  }

  el.innerHTML = cards.join("");
}

function kpi(label, value, sub = "", cls = "") {
  return `
    <div class="kpi ${cls}">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value">${escapeHtml(value)}</div>
      ${sub ? `<div class="kpi-sub">${escapeHtml(sub)}</div>` : ""}
    </div>`;
}

function picksUntilMyTurn(state) {
  const numTeams = state.numTeams;
  let pick = currentPickNumber(state);
  for (let i = 0; i < numTeams * 2 + 2; i++) {
    const { teamSlot } = teamSlotForPick(pick + i, numTeams);
    if (teamSlot === state.myTeamSlot) return i;
  }
  return 0;
}

// --- "Your next move" ------------------------------------------------------------
export function renderNextMove() {
  const el = document.getElementById("overview-next");
  if (!el) return;

  const state = getDraftState();
  if (!state) {
    el.innerHTML = `<p class="hint">No draft in progress. Open the <strong>Draft Room</strong> to start logging picks — the cheat sheet below is live either way, so you can use it as a standalone board.</p>`;
    return;
  }

  const drafted = draftedIdSet(state);
  const ranked = rankFullPool().filter((r) => !drafted.has(r.player.providerPlayerId));
  const mine = isMyPick(state);
  const until = picksUntilMyTurn(state);

  const top3 = ranked.slice(0, 3);
  const listHtml = top3
    .map(
      (r, i) => `
      <div class="cheat-row">
        <span class="cheat-rank">${i + 1}</span>
        <span class="cheat-name"><strong>${escapeHtml(r.player.name)}</strong></span>
        <span class="pos-badge pos-${escapeHtml(r.player.position)}">${escapeHtml(r.player.position)}</span>
        <span class="cheat-team">${escapeHtml(r.player.team)}</span>
        <span class="cheat-score">${r.scoreResult.score.toFixed(0)}</span>
      </div>`
    )
    .join("");

  el.innerHTML = `
    <p class="hint" style="margin-top:0">${
      mine
        ? "<strong>You're on the clock.</strong> Highest-value players left, by pure score:"
        : `${until} pick${until === 1 ? "" : "s"} until your turn. Highest-value players left:`
    }</p>
    ${listHtml}
    <p class="hint">Full reasoning, roster-need weighting, and your stated preferences live on the <strong>Players</strong> tab.</p>
  `;
}

// --- Cheat sheet -----------------------------------------------------------------
/** One column per position, players grouped into tier bands. The band break is the
 * point where value actually drops — that's the whole reason a cheat sheet beats a
 * flat ranking list. Drafted players stay visible but struck through, so the shape of
 * the run at each position is obvious at a glance. */
export function renderCheatSheet() {
  const el = document.getElementById("cheatsheet-content");
  if (!el) return;

  const ranked = rankFullPool();
  if (!ranked.length) {
    el.innerHTML = `<p class="hint">Player data still loading…</p>`;
    return;
  }

  const drafted = draftedIdSet(getDraftState());

  const columns = CHEAT_POSITIONS.map((pos) => {
    // Within a position, order by TIER first and score second. Ordering purely by
    // blended score interleaves tiers (a tier-2 QB can out-score a tier-1 QB once
    // efficiency/context/risk are blended in), which makes the tier bands repeat and
    // defeats the entire point of a cheat sheet — the bands exist to show you where
    // the drop-off is, so they have to be contiguous and in order.
    const atPos = ranked
      .filter((r) => r.player.position === pos)
      .sort((a, b) => {
        const at = a.scoreResult.tier ?? 99;
        const bt = b.scoreResult.tier ?? 99;
        if (at !== bt) return at - bt;
        return b.scoreResult.score - a.scoreResult.score;
      })
      .slice(0, PER_COLUMN);
    if (!atPos.length) {
      return `
        <div class="cheat-col">
          <div class="cheat-col-head" style="background: var(--pos-${pos.toLowerCase()})">${pos}</div>
          <div class="cheat-row"><span class="cheat-name hint">No ${escapeHtml(pos)} data in the pool yet.</span></div>
        </div>`;
    }

    let lastTier = null;
    const rows = atPos
      .map((r, i) => {
        const tier = r.scoreResult.tier ?? null;
        let bandHtml = "";
        if (tier !== lastTier) {
          lastTier = tier;
          bandHtml = `<div class="cheat-tier">Tier ${tier ?? "—"}</div>`;
        }
        const gone = drafted.has(r.player.providerPlayerId);
        const market = marketForTeam(r.player.team);
        return `${bandHtml}
          <div class="cheat-row ${gone ? "is-gone" : ""}">
            <span class="cheat-rank">${i + 1}</span>
            <span class="cheat-name">${escapeHtml(r.player.name)}</span>
            ${market ? marketBadgeHtml(market, trendFor(market.ticker)) : ""}
            <span class="cheat-team">${escapeHtml(r.player.team)}</span>
            <span class="cheat-score">${r.scoreResult.score.toFixed(0)}</span>
          </div>`;
      })
      .join("");

    return `
      <div class="cheat-col">
        <div class="cheat-col-head" style="background: var(--pos-${pos.toLowerCase()})">${pos}</div>
        ${rows}
      </div>`;
  }).join("");

  el.innerHTML = columns;
}

// --- Top-10 chart ----------------------------------------------------------------
// The chart lives on this tab, so this module owns it. Keeping it here (rather than in
// the Players tab's render) means filtering the player table to RBs doesn't silently
// redraw the Overview's "top 10 available" as an RB-only chart.

/** Read a CSS custom property so the chart follows the same palette and light/dark
 * theme as everything else, instead of drifting out of sync with hardcoded hexes. */
function cssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

let overviewChart = null;

/** No-dependency fallback bars, used when Chart.js can't load (blocked CDN, offline,
 * corporate network). An empty card reads as broken; this reads as the same
 * information, just plainer — and it means the most-used view on the page has no hard
 * dependency on a third-party script at all. */
function renderFallbackBars(wrap, top) {
  wrap.innerHTML = `
    <div class="fallback-bars">
      ${top
        .map(
          (r) => `
        <div class="fallback-bar-row">
          <span class="fallback-bar-name">${escapeHtml(r.player.name)}</span>
          <span class="pos-badge pos-${escapeHtml(r.player.position)}">${escapeHtml(r.player.position)}</span>
          <div class="fallback-bar-track">
            <div class="fallback-bar-fill pos-fill-${escapeHtml(r.player.position)}" style="width:${Math.max(0, Math.min(100, r.scoreResult.score))}%"></div>
          </div>
          <span class="fallback-bar-value">${r.scoreResult.score.toFixed(0)}</span>
        </div>`
        )
        .join("")}
    </div>`;
}

export function renderOverviewChart() {
  const canvas = document.getElementById("available-chart");
  const wrap = document.querySelector(".chart-wrap");
  if (!wrap) return;

  const drafted = draftedIdSet(getDraftState());
  const top = rankFullPool()
    .filter((r) => !drafted.has(r.player.providerPlayerId))
    .slice(0, 10);
  if (!top.length) return;

  // Chart.js comes from a CDN. If it isn't there, draw the same thing with CSS rather
  // than leaving an empty box.
  if (!canvas || typeof Chart === "undefined") {
    renderFallbackBars(wrap, top);
    return;
  }

  const colors = {
    QB: cssVar("--pos-qb", "#7c3aed"),
    RB: cssVar("--pos-rb", "#059669"),
    WR: cssVar("--pos-wr", "#0284c7"),
    TE: cssVar("--pos-te", "#d97706"),
    K: cssVar("--pos-k", "#64748b"),
    DEF: cssVar("--pos-def", "#dc2626"),
  };
  const gridColor = cssVar("--line", "#e0e4ee");
  const tickColor = cssVar("--ink-3", "#7c869c");
  const labelColor = cssVar("--ink", "#0f1420");

  if (overviewChart) overviewChart.destroy();
  overviewChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: top.map((r) => r.player.name),
      datasets: [
        {
          label: "Blended score (0-100)",
          data: top.map((r) => r.scoreResult.score),
          backgroundColor: top.map((r) => colors[r.player.position] || tickColor),
          borderRadius: 4,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { min: 0, max: 100, grid: { color: gridColor }, ticks: { color: tickColor } },
        y: { grid: { display: false }, ticks: { color: labelColor } },
      },
    },
  });
}

export function renderOverview() {
  renderKpis();
  renderNextMove();
  renderCheatSheet();
  renderOverviewChart();
}
