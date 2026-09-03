import * as yahooAuth from "../shared/yahoo-auth.js";
import { getEspnLeague } from "../shared/espn-client.js";
import { saveJSON, loadJSON } from "../shared/storage.js";
import { LEAGUES, DEFAULT_ROSTER_SLOTS } from "../shared/data-sources.js";
import { YAHOO_CLIENT_ID } from "../shared/config.js";
import {
  initDraftState,
  getDraftState,
  clearDraftState,
  isMyPick,
  currentPickNumber,
  teamSlotForPick,
  getAvailablePlayers,
  getRosterForSlot,
  getMyRoster,
  getRosterNeeds,
  recordPick,
} from "../shared/draft-state.js";
import { pickForOpponent, simulateUntilMyTurn } from "../shared/mock-draft.js";
import { scorePlayer, buildScoringCaches, DEFAULT_TIER_WEIGHTS } from "../shared/scoring-engine.js";
import { getPreferences, findMatchingPreference } from "../shared/preferences.js";
import { applyPreferenceLayer, acknowledgeOverride } from "../shared/preference-engine.js";

const WEIGHTS_KEY = "tier_weights";
const STRATEGY_KEY = "strategy_preset"; // "recommended" | "brain" | "custom"
const NEED_SLIDER_KEY = "need_awareness_slider"; // 0-100, only meaningful in "custom"

// --- Error boundary --------------------------------------------------------------
// Non-negotiable requirement (user, draft night): the app must never crash, blank,
// or freeze silently. Every entry point below (event handlers, the boot sequence,
// and anything Chart.js/browser APIs throw asynchronously) funnels through here so a
// real error always surfaces as a small dismissible banner instead of a dead page.
function showErrorBanner(label, err) {
  const banner = document.getElementById("error-banner");
  const text = document.getElementById("error-banner-text");
  if (!banner || !text) {
    // Absolute last resort if the banner itself isn't in the DOM for some reason.
    console.error(`[${label}]`, err);
    return;
  }
  const message = err && err.message ? err.message : String(err);
  text.textContent = `Something went wrong (${label}): ${message} — the rest of the app should still work. Try the action again, or refresh if it repeats.`;
  banner.hidden = false;
  try {
    logDebug(`Error boundary caught (${label})`, { message, stack: err && err.stack });
  } catch {
    // logDebug itself failing must never re-throw and hide the banner we just set.
  }
}

/** Wrap any event-handler function so a thrown error (sync or from a returned
 * promise) shows the banner instead of silently dying and leaving the UI stuck. */
function safe(fn, label) {
  return function safeWrapped(...args) {
    try {
      const result = fn.apply(this, args);
      if (result && typeof result.catch === "function") {
        result.catch((err) => showErrorBanner(label, err));
      }
      return result;
    } catch (err) {
      showErrorBanner(label, err);
      return undefined;
    }
  };
}

/** Disables a button and shows a spinner for the duration of `fn` (sync or async) —
 * so a click always visibly registers immediately, never "did that do anything?" */
async function withBusy(btn, fn) {
  if (!btn) return fn();
  btn.classList.add("is-busy");
  btn.disabled = true;
  try {
    return await fn();
  } finally {
    btn.classList.remove("is-busy");
    btn.disabled = false;
  }
}

// --- Strategy preset (Settings: "you chose" / "the brain" / "custom") --------------
// The one axis that genuinely reorders recommendations today: with a single scoring
// tier implemented, scaling that tier's own weight can't change ranking order (it
// multiplies every score by the same constant). Need-awareness — whether an open
// roster need outranks pure score — is real and testable, so it's what these three
// presets actually control until Efficiency/Contextual/Risk exist.
function getStrategyPreset() {
  const preset = loadJSON(STRATEGY_KEY, "recommended");
  return ["recommended", "brain", "custom"].includes(preset) ? preset : "recommended";
}
function setStrategyPreset(preset) {
  saveJSON(STRATEGY_KEY, preset);
}
function getNeedAwarenessSlider() {
  const raw = loadJSON(NEED_SLIDER_KEY, 100);
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100;
}
function setNeedAwarenessSlider(value) {
  const n = Number(value);
  saveJSON(NEED_SLIDER_KEY, Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100);
}
/** Effective 0..1 blend factor for the current preset. 1 = needs always outrank pure
 * score (today's original behavior). 0 = pure score, needs ignored entirely — "the
 * most points at all times no matter what." */
function effectiveNeedAwareness() {
  const preset = getStrategyPreset();
  if (preset === "brain") return 0;
  if (preset === "custom") return getNeedAwarenessSlider() / 100;
  return 1; // "recommended"
}
function strategyDescription(preset) {
  if (preset === "brain")
    return "The Brain: pure VORP/tier score, roster needs ignored entirely — the highest-value player wins even at a position you don't need.";
  if (preset === "custom")
    return `Custom: blending needs-awareness at ${getNeedAwarenessSlider()}% (0% = pure Brain, 100% = full Recommended).`;
  return "Recommended: an open roster need always outranks pure score — our default, tuned to build a complete roster.";
}
/** Sort by score plus a need boost scaled by `needAwareness` (0..1). At 1, any
 * need-filling player's boost (max score in the pool) guarantees it outranks every
 * non-need player — reproducing the original hard "needs first" sort exactly. At 0,
 * boost is zero for everyone, so this is pure score order. In between, it's a genuine
 * blend, not a hack. */
function sortByStrategy(ranked, neededPositions, needAwareness) {
  const maxScore = ranked.length ? Math.max(...ranked.map((r) => r.scoreResult.score), 1) : 1;
  return ranked
    .slice()
    .sort((a, b) => {
      const aBoost = neededPositions.has(a.player.position) ? needAwareness * maxScore : 0;
      const bBoost = neededPositions.has(b.player.position) ? needAwareness * maxScore : 0;
      return b.scoreResult.score + bBoost - (a.scoreResult.score + aBoost);
    });
}

// --- Theme toggle -----------------------------------------------------------
const THEME_KEY = "theme";
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.getElementById("theme-toggle").textContent = theme === "light" ? "☀" : "☾";
}
function initTheme() {
  const saved = loadJSON(THEME_KEY, "dark");
  applyTheme(saved);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    saveJSON(THEME_KEY, next);
    applyTheme(next);
  });
}

// --- Tab navigation ----------------------------------------------------------
function initTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  tabButtons.forEach((btn) => {
    btn.addEventListener(
      "click",
      safe(() => {
        tabButtons.forEach((b) => b.classList.remove("is-active"));
        document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
        btn.classList.add("is-active");
        document.getElementById(`panel-${btn.dataset.panel}`).classList.add("is-active");
      }, "switch tab")
    );
  });
}

// --- Debug output helper ------------------------------------------------------
function logDebug(label, data) {
  const el = document.getElementById("debug-output");
  el.hidden = false;
  el.textContent += `\n[${new Date().toISOString()}] ${label}\n${JSON.stringify(data, null, 2)}\n`;
  el.scrollTop = el.scrollHeight;
}

// --- Yahoo connect -------------------------------------------------------------
function setYahooStatus(text, cls) {
  const el = document.getElementById("yahoo-status");
  el.textContent = text;
  el.className = `status ${cls}`;
}

async function initYahoo() {
  const tokens = await yahooAuth.handleRedirectCallback().catch((err) => {
    logDebug("Yahoo redirect callback error", String(err));
    return null;
  });
  if (tokens) logDebug("Yahoo token exchange succeeded", { expires_in: tokens.expires_in });

  setYahooStatus(
    yahooAuth.isConnected() ? "Connected" : "Not connected",
    yahooAuth.isConnected() ? "status-connected" : "status-pending"
  );

  const yahooBtn = document.getElementById("yahoo-connect-btn");
  yahooBtn.addEventListener(
    "click",
    safe(
      () =>
        withBusy(yahooBtn, async () => {
          if (!YAHOO_CLIENT_ID) {
            logDebug("Yahoo connect blocked", "No client ID configured — see shared/config.js");
            setYahooStatus("Missing client ID (see debug output)", "status-error");
            return;
          }
          const url = await yahooAuth.buildAuthUrl(YAHOO_CLIENT_ID);
          location.href = url;
        }),
      "connect Yahoo"
    )
  );
}

// --- ESPN connect --------------------------------------------------------------
function setEspnStatus(text, cls) {
  const el = document.getElementById("espn-status");
  el.textContent = text;
  el.className = `status ${cls}`;
}

async function checkEspn() {
  setEspnStatus("Checking…", "status-pending");
  try {
    const data = await getEspnLeague(["mSettings"]);
    logDebug("ESPN league response", data);
    setEspnStatus("Connected", "status-connected");
  } catch (err) {
    logDebug("ESPN connection error", String(err));
    setEspnStatus("Connection failed (see debug output)", "status-error");
  }
}

// --- Player data: real nflverse-sourced data, placeholder as a last-resort fallback -
// See scripts/build-player-data.mjs for exactly how shared/data/players-live.json is
// built and its own _README for the honest caveats (2024-actuals-based projection
// proxy, not an official 2026 projection — no free source for that exists yet).
let cachedPlayers = null;
let cachedTeamContext = null;
let usingPlaceholderData = false;

async function loadPlayers() {
  if (cachedPlayers) return cachedPlayers;
  try {
    const res = await fetch("/shared/data/players-live.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cachedPlayers = data.players;
    usingPlaceholderData = false;
    return cachedPlayers;
  } catch (err) {
    logDebug("Falling back to placeholder player data", String(err));
    const res = await fetch("/shared/data/placeholder-players.json");
    if (!res.ok) throw new Error(`Failed to load placeholder player data (${res.status})`);
    const data = await res.json();
    cachedPlayers = data.players;
    usingPlaceholderData = true;
    return cachedPlayers;
  }
}

function updateDataSourceBanner() {
  const el = document.getElementById("data-source-banner");
  if (!el) return;
  if (usingPlaceholderData) {
    el.textContent =
      "⚠ Player pool is PLACEHOLDER data (shared/data/placeholder-players.json) — real data failed to load, see debug output. Made-up projections/ADP, do not use for an actual draft.";
    el.className = "placeholder-banner";
  } else {
    const count = cachedPlayers ? cachedPlayers.length : 0;
    el.textContent =
      `✓ Real player data loaded — ${count} players from nflverse (see shared/data/players-live.json's own README). ` +
      `Projections are a 2024-actuals-based estimate, not an official 2026 projection — no free source for that exists yet.`;
    el.className = "data-source-ok";
  }
}

async function loadTeamContext() {
  if (cachedTeamContext) return cachedTeamContext;
  try {
    const res = await fetch("/shared/data/team-context-2026.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    cachedTeamContext = data.teams;
  } catch (err) {
    logDebug("Team context (schedule/odds) unavailable", String(err));
    cachedTeamContext = {};
  }
  return cachedTeamContext;
}

// --- Weights (settings) --------------------------------------------------------
function getWeights() {
  return loadJSON(WEIGHTS_KEY, DEFAULT_TIER_WEIGHTS);
}
function initSettings() {
  const weights = getWeights();
  const sliders = {
    projections: document.getElementById("weight-projections"),
    efficiency: document.getElementById("weight-efficiency"),
    contextual: document.getElementById("weight-contextual"),
    risk: document.getElementById("weight-risk"),
  };
  for (const [key, el] of Object.entries(sliders)) {
    el.value = Math.round((weights[key] ?? 0) * 100);
    el.addEventListener(
      "input",
      safe(() => {
        const current = getWeights();
        current[key] = Number(el.value) / 100;
        saveJSON(WEIGHTS_KEY, current);
        renderAvailablePlayers();
        renderRecommendation();
        renderBoardRecommendation();
      }, "adjust tier weight")
    );
  }

  // Strategy preset — two selects (Settings tab + the inline quick-pick on the
  // Recommendation tab) stay in sync since they read/write the same storage key.
  const presetEls = [
    document.getElementById("strategy-preset"),
    document.getElementById("strategy-preset-inline"),
    document.getElementById("strategy-preset-board"),
  ];
  const needSlider = document.getElementById("need-awareness");

  function syncStrategyUI() {
    const preset = getStrategyPreset();
    presetEls.forEach((el) => el && (el.value = preset));
    if (needSlider) {
      needSlider.value = getNeedAwarenessSlider();
      needSlider.disabled = preset !== "custom";
    }
    const hint = document.getElementById("strategy-inline-hint");
    if (hint) hint.textContent = strategyDescription(preset);
  }

  presetEls.forEach((el) => {
    if (!el) return;
    el.addEventListener(
      "change",
      safe(() => {
        setStrategyPreset(el.value);
        syncStrategyUI();
        renderAvailablePlayers();
        renderRecommendation();
      }, "switch strategy")
    );
  });
  if (needSlider) {
    needSlider.addEventListener(
      "input",
      safe(() => {
        setNeedAwarenessSlider(Number(needSlider.value));
        syncStrategyUI();
        renderRecommendation();
      }, "adjust needs-awareness slider")
    );
  }
  syncStrategyUI();
}

// --- Draft setup / lifecycle ---------------------------------------------------
function refreshSetupVisibility() {
  const state = getDraftState();
  document.getElementById("setup-card").hidden = Boolean(state);
  document.getElementById("board-content").hidden = !state;
  document.getElementById("live-sync-btn").hidden = !(state && state.mode === "live");
}

async function startDraft() {
  const numTeams = Number(document.getElementById("setup-teams").value);
  const myTeamSlot = Number(document.getElementById("setup-slot").value);
  const mode = document.getElementById("setup-mode").value;
  const players = await loadPlayers();
  updateDataSourceBanner();
  await loadTeamContext();

  initDraftState({
    numTeams,
    myTeamSlot,
    mode,
    rosterSlots: DEFAULT_ROSTER_SLOTS,
    players,
  });

  refreshSetupVisibility();
  renderAll();
}

function resetDraft() {
  clearDraftState();
  clearScoredAvailableCache();
  refreshSetupVisibility();
  renderAll();
}

// --- Rendering: Draft Board ------------------------------------------------------
function renderBoard() {
  const state = getDraftState();
  if (!state) return;

  const pickNum = currentPickNumber(state);
  const { round, teamSlot } = teamSlotForPick(pickNum, state.numTeams);
  const mine = isMyPick(state);
  const clockEl = document.getElementById("on-the-clock");
  clockEl.textContent = `Pick ${pickNum} · Round ${round} · Team ${teamSlot}${mine ? " (YOU)" : ""}`;
  clockEl.className = `status ${mine ? "status-connected" : "status-pending"}`;

  const tbody = document.querySelector("#picks-table tbody");
  tbody.innerHTML = "";
  for (const pick of state.picks.slice().reverse()) {
    const player = state.players.find((p) => p.providerPlayerId === pick.providerPlayerId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${pick.pickNumber}</td>
      <td>${pick.round}</td>
      <td>${pick.teamSlot}${pick.teamSlot === state.myTeamSlot ? " (you)" : ""}</td>
      <td>${player ? player.name : "?"}</td>
      <td><span class="pos-badge pos-${player ? player.position : ""}">${player ? player.position : "?"}</span></td>
    `;
    tbody.appendChild(tr);
  }
}

// --- Rendering: Available Players ------------------------------------------------
// PERFORMANCE-CRITICAL (see shared/scoring-engine.js's buildScoringCaches doc
// comment): the replacement-level/tier/VORP-pool passes are each O(n log n) over the
// ~800-player real pool. Compute them ONCE per ranking pass here and reuse them for
// every player, instead of letting scorePlayer recompute them per player — the
// earlier version of this function did the latter, which is what was actually
// hanging/crashing the app on the real dataset (confirmed via headless-browser
// repro, 2026-09-03). Also memoized per render cycle (see renderAll/clearScoreCache)
// since three separate panels (Available Players, Recommendation, Board sidebar) all
// need the same ranking on every render — no reason to compute it three times over.
let scoredAvailableCache = null; // { key, result }
function scoredAvailableCacheKey(state) {
  return `${state.picks.length}:${JSON.stringify(getWeights())}`;
}
function clearScoredAvailableCache() {
  scoredAvailableCache = null;
}
function scoredAvailable(state) {
  const key = scoredAvailableCacheKey(state);
  if (scoredAvailableCache && scoredAvailableCache.key === key) return scoredAvailableCache.result;

  const available = getAvailablePlayers(state);
  const weights = getWeights();
  const leagueSettings = {
    numTeams: state.numTeams,
    startersPerTeamByPosition: { QB: 1, RB: 2.5, WR: 2.5, TE: 1, K: 1, DEF: 1 },
  };
  const caches = buildScoringCaches(available, leagueSettings);
  const result = available
    .map((p) => ({
      player: p,
      scoreResult: scorePlayer(
        p,
        { allPlayersAtPosition: available, leagueSettings, teamContext: cachedTeamContext || {}, ...caches },
        weights
      ),
    }))
    .sort((a, b) => b.scoreResult.score - a.scoreResult.score);

  scoredAvailableCache = { key, result };
  return result;
}

function playerAvatarHtml(player) {
  if (!player.headshot) return `<span class="avatar avatar-fallback">${player.position}</span>`;
  return `<img class="avatar" src="${player.headshot}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;avatar avatar-fallback&quot;>${player.position}</span>'" />`;
}

function injuryBadgeHtml(player) {
  const status = (player.injuryStatus || "").toLowerCase();
  if (!status) return "";
  const cls = status.includes("out") || status.includes("ir")
    ? "injury-out"
    : status.includes("doubtful")
      ? "injury-doubtful"
      : "injury-questionable";
  return `<span class="injury-badge ${cls}" title="${player.injuryNote || ""}">${player.injuryStatus}</span>`;
}

// Chart.js instance, recreated on each render rather than mutated in place — simplest
// correct approach for a table that can change shape (filter/weights/strategy) often.
let availableChart = null;
function renderAvailableChart(ranked) {
  const canvas = document.getElementById("available-chart");
  if (!canvas || typeof Chart === "undefined") return; // Chart.js CDN blocked/offline — degrade gracefully, no crash
  const top = ranked.slice(0, 10);
  const colors = {
    QB: "#c77dff",
    RB: "#00ff87",
    WR: "#4cc9f0",
    TE: "#ffb703",
    K: "#9fb3c8",
    DEF: "#ef476f",
  };

  if (availableChart) availableChart.destroy();
  availableChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: top.map((r) => r.player.name),
      datasets: [
        {
          label: "Score (0-100, blended tiers)",
          data: top.map((r) => r.scoreResult.score),
          backgroundColor: top.map((r) => colors[r.player.position] || "#8ea3b8"),
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { min: 0, max: 100, grid: { color: "#22415c" }, ticks: { color: "#8ea3b8" } },
        y: { grid: { display: false }, ticks: { color: "#e8f1f8" } },
      },
    },
  });
}

function renderAvailablePlayers() {
  const state = getDraftState();
  const tbody = document.querySelector("#available-table tbody");
  tbody.innerHTML = "";
  if (!state) return;

  const filter = document.getElementById("position-filter").value;
  const ranked = scoredAvailable(state).filter(
    (r) => filter === "ALL" || r.player.position === filter
  );
  renderAvailableChart(ranked);

  const mine = isMyPick(state);
  for (const { player, scoreResult } of ranked.slice(0, 60)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="player-cell">${playerAvatarHtml(player)}<span>${player.name}</span> ${injuryBadgeHtml(player)}</td>
      <td><span class="pos-badge pos-${player.position}">${player.position}</span></td>
      <td>${player.team}${player.byeWeek ? ` <span class="tag">bye ${player.byeWeek}</span>` : ""}</td>
      <td>Tier ${scoreResult.tier ?? "?"}</td>
      <td class="numeric">${scoreResult.vorp.toFixed(1)}</td>
      <td class="numeric"><strong>${scoreResult.score.toFixed(0)}</strong></td>
      <td><button class="btn btn-primary btn-draft" data-player="${player.providerPlayerId}" ${mine ? "" : "disabled"}>Draft</button></td>
    `;
    tbody.appendChild(tr);
  }

  wireDraftButtons(tbody);
}

function draftPlayer(providerPlayerId) {
  const state = getDraftState();
  if (!state || !isMyPick(state)) return;
  recordPick(state, providerPlayerId, "manual");
  renderAll();
}

// --- Tier-breakdown visualization (no chart library needed for this one — four
// small percentage bars, color-coded, one per scoring tier) --------------------------
const TIER_LABELS = { projections: "Proj", efficiency: "Eff", contextual: "Ctx", risk: "Risk" };
function renderTierBars(tierBreakdown) {
  const rows = Object.entries(TIER_LABELS)
    .map(([key, label]) => {
      const value = Math.max(0, Math.min(100, Math.round(tierBreakdown[key] ?? 0)));
      return `
        <div class="tier-bar-row">
          <span class="tier-bar-label">${label}</span>
          <div class="tier-bar-track"><div class="tier-bar-fill tier-bar-${key}" style="width:${value}%"></div></div>
          <span class="tier-bar-value">${value}</span>
        </div>`;
    })
    .join("");
  return `<div class="tier-bars">${rows}</div>`;
}

// --- Rendering: Recommendation ----------------------------------------------------
/** All the ranking/compare logic, shared between the full Recommendation tab and the
 * compact live sidebar on the Draft Board tab — both must always agree, since showing
 * two different "top picks" at once would be worse than showing just one. Returns
 * null when there's nothing to rank (no draft, or not my pick). */
function computeRecommendationView() {
  const state = getDraftState();
  if (!state) return { status: "no-draft" };
  if (!isMyPick(state)) {
    const pickNum = currentPickNumber(state);
    const { teamSlot, round } = teamSlotForPick(pickNum, state.numTeams);
    return { status: "not-my-turn", pickNum, teamSlot, round };
  }

  const needs = getRosterNeeds(state, state.myTeamSlot);
  const neededPositions = new Set(needs.flatMap((n) => n.eligiblePositions));
  const scored = scoredAvailable(state);

  const preset = getStrategyPreset();
  const needAwareness = effectiveNeedAwareness();
  const ranked = sortByStrategy(scored, neededPositions, needAwareness);

  const recommendedTop = sortByStrategy(scored, neededPositions, 1)[0];
  const brainTop = sortByStrategy(scored, neededPositions, 0)[0];

  return { status: "ready", preset, ranked, recommendedTop, brainTop };
}

function recCardHtml(player, scoreResult, rank) {
  const isCliffLine = (r) => r.includes("left in this tier");
  const cliffLine = scoreResult.reasoning.find(isCliffLine);
  const reasoningItems = scoreResult.reasoning
    .filter((r) => !isCliffLine(r))
    .map((r) => `<li>${r}</li>`)
    .join("");
  const cliff = cliffLine ? `<li class="cliff-warning">⚠ ${cliffLine}</li>` : "";
  const tierBars = scoreResult.tierBreakdown ? renderTierBars(scoreResult.tierBreakdown) : "";
  return `
    <div class="rec-card rank-${rank}">
      <h4>#${rank} ${player.name} <span class="pos-badge pos-${player.position}">${player.position}</span> — ${player.team}</h4>
      ${tierBars}
      <ul>${reasoningItems}${cliff}</ul>
      <button class="btn btn-primary btn-draft" data-player="${player.providerPlayerId}">Draft this player</button>
    </div>
  `;
}

function wireDraftButtons(container) {
  container.querySelectorAll(".btn-draft").forEach((btn) => {
    btn.addEventListener(
      "click",
      safe(() => withBusy(btn, () => draftPlayer(btn.dataset.player)), "draft player")
    );
  });
}

function renderRecommendation() {
  const container = document.getElementById("recommendation-content");
  const prefContainer = document.getElementById("preference-layer-content");
  if (!container) return;

  const view = computeRecommendationView();

  if (view.status === "no-draft") {
    container.innerHTML = `<p class="hint">Start a draft on the Draft Board tab first.</p>`;
    if (prefContainer) prefContainer.innerHTML = "";
    return;
  }
  if (view.status === "not-my-turn") {
    container.innerHTML = `<p class="hint">Waiting — pick ${view.pickNum} (round ${view.round}) belongs to Team ${view.teamSlot}. Use "Simulate to my turn" on the Draft Board tab in practice mode.</p>`;
    if (prefContainer) prefContainer.innerHTML = "";
    return;
  }

  const { preset, ranked, recommendedTop, brainTop } = view;

  // Show the honest delta between "Recommended" and "The Brain" whenever they'd
  // actually pick differently right now — this is the whole point of the preset
  // selector: see the difference before you commit to a pick, not after.
  let modeCompareHtml = "";
  if (recommendedTop && brainTop && recommendedTop.player.providerPlayerId !== brainTop.player.providerPlayerId) {
    modeCompareHtml = `
      <div class="card">
        <p class="hint"><strong>Recommended</strong> would take <strong>${recommendedTop.player.name}</strong> (${recommendedTop.player.position}, fills a need) —
        <strong>The Brain</strong> would take <strong>${brainTop.player.name}</strong> (${brainTop.player.position}, ${brainTop.scoreResult.score.toFixed(1)} VORP, highest pure score regardless of need).
        You're currently viewing recommendations under <strong>${preset === "recommended" ? "Recommended" : preset === "brain" ? "The Brain" : "Custom"}</strong>.</p>
      </div>`;
  }

  const top3 = ranked.slice(0, 3);
  container.innerHTML =
    modeCompareHtml + top3.map(({ player, scoreResult }, i) => recCardHtml(player, scoreResult, i + 1)).join("");

  wireDraftButtons(container);
  renderPreferenceLayer(ranked);
}

/** Compact version of the same recommendation, rendered into the Draft Board tab's
 * sidebar so the board and the recommendation are visible at the same time — no tab
 * switching mid-pick. Always reflects the exact same ranking as the full tab. */
function renderBoardRecommendation() {
  const container = document.getElementById("board-rec-content");
  if (!container) return;

  const view = computeRecommendationView();

  if (view.status === "no-draft") {
    container.innerHTML = `<p class="hint">Start a draft to see live recommendations here.</p>`;
    return;
  }
  if (view.status === "not-my-turn") {
    container.innerHTML = `<p class="hint">Waiting on Team ${view.teamSlot} (pick ${view.pickNum}, round ${view.round}).</p>`;
    return;
  }

  const top = view.ranked[0];
  if (!top) {
    container.innerHTML = `<p class="hint">No players left to rank.</p>`;
    return;
  }
  container.innerHTML = recCardHtml(top.player, top.scoreResult, 1);
  wireDraftButtons(container);
}

// --- Rendering: Personal preference layer ------------------------------------------
// Founding requirement: show the model's real #1 pick under the currently selected
// strategy mode, show the user's stated preference if one is still available, show
// the honest delta, let the user decide — never blend the bias into the model's own
// number, and never punish a future recommendation for having overridden this one.
function renderPreferenceLayer(ranked) {
  const container = document.getElementById("preference-layer-content");
  if (!container || !ranked.length) {
    if (container) container.innerHTML = "";
    return;
  }

  const prefs = getPreferences();
  const availablePlayers = ranked.map((r) => r.player);
  const match = findMatchingPreference(prefs, availablePlayers);
  const result = applyPreferenceLayer(ranked[0], match, ranked);

  if (!result) {
    container.innerHTML = "";
    return;
  }

  if (result.aligned) {
    container.innerHTML = `<div class="card"><p class="hint">✓ ${result.message}</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="card">
      <h3>Your stated preference vs. the model</h3>
      <p class="hint">${result.message}</p>
      <div class="card-row">
        <button class="btn btn-primary btn-draft" data-player="${result.modelPick.player.providerPlayerId}">
          Take the model's pick — ${result.modelPick.player.name}
        </button>
        <button class="btn btn-ghost btn-draft-override" data-player="${result.preferredPick.player.providerPlayerId}" data-name="${result.preferredPick.player.name}">
          Override — take ${result.preferredPick.player.name}
        </button>
      </div>
    </div>
  `;

  wireDraftButtons(container);
  container.querySelectorAll(".btn-draft-override").forEach((btn) => {
    btn.addEventListener(
      "click",
      safe(() =>
        withBusy(btn, () => {
          logDebug("Preference override", acknowledgeOverride(btn.dataset.name));
          draftPlayer(btn.dataset.player);
        })
      , "override preference")
    );
  });
}

// --- Rendering: My Roster -----------------------------------------------------------
/** All starting slots (not just open ones) with filled/total counts, for the roster
 * needs progress-bar visualization. Mirrors getRosterNeeds' allocation logic but
 * reports every slot, not just the ones still open. */
function computeAllSlotStatus(state, teamSlot) {
  const roster = getRosterForSlot(state, teamSlot);
  const counts = {};
  for (const p of roster) counts[p.position] = (counts[p.position] || 0) + 1;

  return state.rosterSlots
    .filter((slotDef) => slotDef.slot !== "BN" && slotDef.slot !== "IR")
    .map((slotDef) => {
      const filled = slotDef.eligiblePositions.reduce(
        (sum, pos) => sum + Math.min(counts[pos] || 0, slotDef.count),
        0
      );
      return { slot: slotDef.slot, count: slotDef.count, filled: Math.min(filled, slotDef.count) };
    });
}

function renderNeedsBars(slotStatus) {
  const rows = slotStatus
    .map(({ slot, count, filled }) => {
      const pct = count > 0 ? Math.round((filled / count) * 100) : 0;
      const openCls = filled < count ? "needs-open" : "";
      return `
        <div class="need-bar-row">
          <span class="need-bar-label">${slot}</span>
          <div class="need-bar-track"><div class="need-bar-fill ${openCls}" style="width:${pct}%"></div></div>
          <span class="need-bar-text">${filled}/${count} filled</span>
        </div>`;
    })
    .join("");
  return `<div class="needs-bars">${rows}</div>`;
}

function renderRoster() {
  const container = document.getElementById("roster-content");
  const state = getDraftState();
  if (!state) {
    container.innerHTML = `<p class="hint">Start a draft on the Draft Board tab first.</p>`;
    return;
  }

  const roster = getMyRoster(state);
  const slotStatus = computeAllSlotStatus(state, state.myTeamSlot);

  const rosterRows = roster
    .map(
      (p) =>
        `<tr><td class="player-cell">${playerAvatarHtml(p)}<span>${p.name}</span></td><td><span class="pos-badge pos-${p.position}">${p.position}</span></td><td>${p.team}${p.byeWeek ? ` <span class="tag">bye ${p.byeWeek}</span>` : ""}</td></tr>`
    )
    .join("");

  container.innerHTML = `
    <h3>Roster needs</h3>
    ${renderNeedsBars(slotStatus)}
    <table class="data-table">
      <thead><tr><th>Player</th><th>Pos</th><th>Team</th></tr></thead>
      <tbody>${rosterRows || `<tr><td colspan="3">No picks yet.</td></tr>`}</tbody>
    </table>
  `;
}

/** Run each render function independently — a bug in one panel's rendering must
 * never blank out the others (or the whole page). Each failure surfaces via the
 * error banner and that one section is left showing its last-good content. */
function renderAll() {
  const sections = [
    ["draft board", renderBoard],
    ["available players", renderAvailablePlayers],
    ["recommendation", renderRecommendation],
    ["live board recommendation", renderBoardRecommendation],
    ["roster", renderRoster],
  ];
  for (const [label, fn] of sections) {
    try {
      fn();
    } catch (err) {
      showErrorBanner(`rendering ${label}`, err);
    }
  }
}

// --- Live sync (see shared/live-sync.js — real structure, unverified against a real
// live draft yet, see docs/DATA_SOURCES.md) -----------------------------------------
async function handleLiveSync() {
  logDebug(
    "Live sync",
    "live-sync.js needs a real Yahoo/ESPN draftresults payload shape before this can " +
      "actually map picks — not wired to a button action yet. See shared/live-sync.js TODOs."
  );
}

// --- Boot ------------------------------------------------------------------------
function main() {
  // Last-resort catch-all: anything that throws outside our own try/catches (a
  // browser API, a CDN script like Chart.js, a timer callback) still surfaces here
  // instead of leaving the page looking frozen with no explanation.
  window.addEventListener("error", (event) => {
    showErrorBanner("unexpected error", event.error || event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    showErrorBanner("unexpected error", event.reason);
  });

  const dismissBtn = document.getElementById("error-banner-dismiss");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      document.getElementById("error-banner").hidden = true;
    });
  }

  initTheme();
  initTabs();
  initYahoo();
  initSettings();

  const espnBtn = document.getElementById("espn-check-btn");
  espnBtn.addEventListener("click", safe(() => withBusy(espnBtn, checkEspn), "check ESPN connection"));

  const startBtn = document.getElementById("setup-start-btn");
  startBtn.addEventListener(
    "click",
    safe(() => withBusy(startBtn, startDraft), "start draft")
  );

  document.getElementById("setup-reset-btn").addEventListener("click", safe(resetDraft, "reset draft"));
  document.getElementById("position-filter").addEventListener("change", safe(renderAvailablePlayers, "filter players"));
  document.getElementById("live-sync-btn").addEventListener("click", safe(handleLiveSync, "live sync"));

  const simulateBtn = document.getElementById("simulate-btn");
  simulateBtn.addEventListener(
    "click",
    safe(
      () =>
        withBusy(simulateBtn, async () => {
          const state = getDraftState();
          if (!state) return;
          // Yield one frame first so the button's busy state actually paints before
          // the (synchronous, can take a moment with many mock picks) simulation runs.
          await new Promise((resolve) => setTimeout(resolve, 0));
          simulateUntilMyTurn(state, isMyPick);
          renderAll();
        }),
      "simulate to my turn"
    )
  );

  refreshSetupVisibility();
  renderAll();
  loadPlayers()
    .then(updateDataSourceBanner)
    .catch((err) => showErrorBanner("loading player data", err));
  logDebug("App booted", { leagues: LEAGUES });
}

try {
  main();
} catch (err) {
  showErrorBanner("app startup", err);
}
