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
import {
  getRosterSource,
  setRosterSource,
  clearRosterCache,
  resolveMyRoster,
} from "../shared/roster-source.js";
import { getEspnTeams, getSavedEspnTeamId, saveEspnTeamId } from "../shared/espn-roster.js";

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
/** Same-team "stacking" downside: rostering multiple players from the same NFL team
 * correlates their weekly outcomes (one bad game plan drags both down together) and,
 * when bye weeks match exactly, benches both in the same week with no way to cover it.
 * Not a hard block — real drafters do sometimes stack on purpose — just a bias, scaled
 * by the same `needAwareness` factor as positional needs so "The Brain" (pure
 * best-player-available, explicitly documented as ignoring roster context) stays
 * exactly that: pure. Returns { amount, note } — amount is a sort-key penalty in the
 * same units as score, note is a user-facing explanation or null. */
function stackingPenalty(player, myRoster, needAwareness, maxScore) {
  if (!needAwareness || !myRoster.length) return { amount: 0, note: null };
  const teammate = myRoster.find((p) => p.team && p.team === player.team);
  if (!teammate) return { amount: 0, note: null };
  const sameBye = Boolean(teammate.byeWeek) && teammate.byeWeek === player.byeWeek;
  const fraction = sameBye ? 0.35 : 0.15;
  const note = sameBye
    ? `Same team AND bye week (${player.byeWeek}) as your ${teammate.name} — you'd lose both in the same week.`
    : `Also on ${player.team} with your ${teammate.name} on your roster — correlated outcomes, less week-to-week insurance.`;
  return { amount: needAwareness * fraction * maxScore, note };
}

/** Sort by score plus a need boost scaled by `needAwareness` (0..1). At 1, any
 * need-filling player's boost (max score in the pool) guarantees it outranks every
 * non-need player — reproducing the original hard "needs first" sort exactly. At 0,
 * boost is zero for everyone, so this is pure score order. In between, it's a genuine
 * blend, not a hack. `myRoster` (already-drafted players for this team) is optional —
 * when provided, same-team stacking is penalized the same way, scaled by the same
 * needAwareness factor. */
function sortByStrategy(ranked, neededPositions, needAwareness, myRoster = []) {
  const maxScore = ranked.length ? Math.max(...ranked.map((r) => r.scoreResult.score), 1) : 1;
  return ranked
    .slice()
    .sort((a, b) => {
      const aBoost = neededPositions.has(a.player.position) ? needAwareness * maxScore : 0;
      const bBoost = neededPositions.has(b.player.position) ? needAwareness * maxScore : 0;
      const aStack = stackingPenalty(a.player, myRoster, needAwareness, maxScore).amount;
      const bStack = stackingPenalty(b.player, myRoster, needAwareness, maxScore).amount;
      return b.scoreResult.score + bBoost - bStack - (a.scoreResult.score + aBoost - aStack);
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

/** Yahoo's Fantasy API JSON is deeply and inconsistently nested (numeric-string keys,
 * arrays-of-arrays) depending on the resource — rather than hardcode one exact path
 * (fragile, unverified against a real response), walk the whole tree looking for any
 * object that looks like a team (`name` alongside `team_key`/`team_id`). Works
 * regardless of exactly how deep Yahoo buries it. */
function deepFindYahooTeam(node) {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFindYahooTeam(item);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    if (typeof node.name === "string" && ("team_key" in node || "team_id" in node)) {
      return { name: node.name, teamKey: node.team_key ?? null };
    }
    for (const key of Object.keys(node)) {
      const found = deepFindYahooTeam(node[key]);
      if (found) return found;
    }
  }
  return null;
}

/** Confirms the Yahoo connection actually works end-to-end by resolving the user's
 * own team in the league — not just that the OAuth token exchange succeeded. This is
 * the first real step toward "know my pick, I'm PQ's Squad": before any live draft
 * tracking can work, the app has to correctly identify which team is the user's own. */
async function fetchAndShowMyYahooTeam() {
  const leagueKey = `nfl.l.${LEAGUES.yahoo.leagueId}`;
  try {
    const data = await yahooAuth.callYahoo(
      `users;use_login=1/games;game_keys=nfl/leagues;league_keys=${leagueKey}/teams`
    );
    logDebug("Yahoo 'my teams' raw response", data);
    const team = deepFindYahooTeam(data);
    if (team) {
      setYahooStatus(`Connected — ${team.name}`, "status-connected");
      logDebug("Yahoo team resolved", team);
    } else {
      logDebug(
        "Yahoo connected, but couldn't find a team in the response",
        "See the raw response above — the league may not have started/synced rosters yet, or Yahoo's response shape differs from expected. Connection itself is fine."
      );
    }
  } catch (err) {
    logDebug("Yahoo 'my teams' lookup failed (connection itself still OK)", String(err));
  }
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
  if (yahooAuth.isConnected()) fetchAndShowMyYahooTeam();

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
        renderBoardRecommendation();
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

  // Real-time draft-day mode: the Draft button logs whichever team's turn it
  // currently is (per teamSlotForPick), not only "your" pick. This lets you
  // click the instant you see a pick happen on Yahoo's/ESPN's own screen —
  // yours or an opponent's — instead of waiting on live API polling we can't
  // safely ship untested. recordPick()/teamSlotForPick() already resolve the
  // correct team from the current pick count, so no auto-detection is needed.
  const mine = isMyPick(state);
  const pickNum = currentPickNumber(state);
  const { teamSlot } = teamSlotForPick(pickNum, state.numTeams);
  const draftBtnLabel = mine ? "Draft (YOU)" : `Draft (Team ${teamSlot})`;
  for (const { player, scoreResult } of ranked.slice(0, 60)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="player-cell">${playerAvatarHtml(player)}<span>${player.name}</span> ${injuryBadgeHtml(player)}</td>
      <td><span class="pos-badge pos-${player.position}">${player.position}</span></td>
      <td>${player.team}${player.byeWeek ? ` <span class="tag">bye ${player.byeWeek}</span>` : ""}</td>
      <td>Tier ${scoreResult.tier ?? "?"}</td>
      <td class="numeric">${scoreResult.vorp.toFixed(1)}</td>
      <td class="numeric"><strong>${scoreResult.score.toFixed(0)}</strong></td>
      <td><button class="btn ${mine ? "btn-primary" : "btn-ghost"} btn-draft" data-player="${player.providerPlayerId}" title="Logs this pick for whichever team is currently on the clock">${draftBtnLabel}</button></td>
    `;
    tbody.appendChild(tr);
  }

  wireDraftButtons(tbody);
}

function draftPlayer(providerPlayerId) {
  // Deliberately no isMyPick() gate: draft-day mode lets you log ANY team's
  // pick the moment it happens on Yahoo's/ESPN's own site, in real time.
  // recordPick() below resolves the correct team from the current pick
  // count regardless of whose turn it is.
  const state = getDraftState();
  if (!state) return;
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
  const myRoster = getMyRoster(state);

  const preset = getStrategyPreset();
  const needAwareness = effectiveNeedAwareness();
  const ranked = sortByStrategy(scored, neededPositions, needAwareness, myRoster);

  const recommendedTop = sortByStrategy(scored, neededPositions, 1, myRoster)[0];
  const brainTop = sortByStrategy(scored, neededPositions, 0, myRoster)[0];

  return { status: "ready", preset, ranked, recommendedTop, brainTop, myRoster };
}

function recCardHtml(player, scoreResult, rank, myRoster = []) {
  const isCliffLine = (r) => r.includes("left in this tier");
  const cliffLine = scoreResult.reasoning.find(isCliffLine);
  const reasoningItems = scoreResult.reasoning
    .filter((r) => !isCliffLine(r))
    .map((r) => `<li>${r}</li>`)
    .join("");
  const cliff = cliffLine ? `<li class="cliff-warning">⚠ ${cliffLine}</li>` : "";
  // Surface same-team stacking as a plain fact regardless of Mode — only the ranking
  // itself is mode-dependent (see stackingPenalty/sortByStrategy); the warning below
  // is informational so you can make the call yourself even under "The Brain".
  const stackNote = stackingPenalty(player, myRoster, 1, 1).note;
  const stackWarning = stackNote ? `<li class="cliff-warning">⚠ ${stackNote}</li>` : "";
  const tierBars = scoreResult.tierBreakdown ? renderTierBars(scoreResult.tierBreakdown) : "";
  return `
    <div class="rec-card rank-${rank}">
      <h4>#${rank} ${player.name} <span class="pos-badge pos-${player.position}">${player.position}</span> — ${player.team}</h4>
      ${tierBars}
      <ul>${reasoningItems}${cliff}${stackWarning}</ul>
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
    modeCompareHtml +
    top3.map(({ player, scoreResult }, i) => recCardHtml(player, scoreResult, i + 1, view.myRoster)).join("");

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
  container.innerHTML = recCardHtml(top.player, top.scoreResult, 1, view.myRoster);
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
  return computeSlotStatusFromRoster(roster, state.rosterSlots);
}

/** Same slot-fill counting as computeAllSlotStatus, but taking a plain roster array
 * directly instead of reading it off draft-state — this is what makes My Roster/Lineup
 * work from a live Yahoo/ESPN fetch, which has no local draft-state at all. */
function computeSlotStatusFromRoster(roster, rosterSlots = DEFAULT_ROSTER_SLOTS) {
  const counts = {};
  for (const p of roster) counts[p.position] = (counts[p.position] || 0) + 1;

  return rosterSlots
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

/** Both My Roster and Lineup need "the current roster, regardless of where it comes
 * from" — this is the one place that resolves it, so both tabs always agree. Returns
 * null players on genuine failure (e.g. no local draft and no live source available)
 * rather than throwing, since "nothing to show yet" is a normal, expected state here. */
async function getCurrentRosterView() {
  const state = getDraftState();
  const players = cachedPlayers || (await loadPlayers());
  const result = await resolveMyRoster(state, players);
  const warningEl = document.getElementById("roster-source-warning");
  if (warningEl) warningEl.textContent = result.warning || "";
  return result;
}

function renderRoster() {
  getCurrentRosterView()
    .then(({ players: roster }) => {
      const container = document.getElementById("roster-content");
      if (!container) return;
      if (!roster.length) {
        container.innerHTML = `<p class="hint">No roster yet — start a draft on the Draft Board tab, or pick a connected Yahoo/ESPN source above.</p>`;
        return;
      }

      const slotStatus = computeSlotStatusFromRoster(roster);
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
    })
    .catch((err) => showErrorBanner("rendering roster", err));
}

/** Lineup v1: within each real roster slot (QB, RB, WR, TE, FLEX, K, DEF), rank the
 * eligible rostered players by the same scoring engine used everywhere else in the
 * app and mark the top `count` as Start, the rest as Bench. Bye-week starters are
 * flagged explicitly rather than silently recommended. This is honestly scoped as a
 * "best player available per slot" ranking, NOT a true week-by-week matchup
 * optimizer — see the Lineup tab's own hint text for why (the scoring engine's
 * Contextual tier only has real schedule/odds data for Week 1 2026 so far). */
function renderLineup() {
  getCurrentRosterView()
    .then(async ({ players: roster }) => {
      const container = document.getElementById("lineup-content");
      if (!container) return;
      if (!roster.length) {
        container.innerHTML = `<p class="hint">No roster yet — draft on the Draft tab, or connect Yahoo/ESPN on the Roster tab, first.</p>`;
        return;
      }

      const leagueSettings = {
        numTeams: 10,
        startersPerTeamByPosition: { QB: 1, RB: 2.5, WR: 2.5, TE: 1, K: 1, DEF: 1 },
      };
      const caches = buildScoringCaches(roster, leagueSettings);
      const weights = getWeights();
      const scoredRoster = roster
        .map((player) => ({
          player,
          scoreResult: scorePlayer(
            player,
            { allPlayersAtPosition: roster, leagueSettings, teamContext: cachedTeamContext || {}, ...caches },
            weights
          ),
        }))
        .sort((a, b) => b.scoreResult.score - a.scoreResult.score);

      const usedIds = new Set();
      const slotSections = DEFAULT_ROSTER_SLOTS.filter((s) => s.slot !== "BN" && s.slot !== "IR").map((slotDef) => {
        const eligible = scoredRoster.filter(
          (r) => !usedIds.has(r.player.providerPlayerId) && slotDef.eligiblePositions.includes(r.player.position)
        );
        const starters = eligible.slice(0, slotDef.count);
        starters.forEach((r) => usedIds.add(r.player.providerPlayerId));
        return { slotDef, starters };
      });
      const bench = scoredRoster.filter((r) => !usedIds.has(r.player.providerPlayerId));

      const rowHtml = (r, isStarter) => `
          <tr class="${isStarter ? "lineup-start" : "lineup-bench"}">
            <td class="player-cell">${playerAvatarHtml(r.player)}<span>${r.player.name}</span></td>
            <td><span class="pos-badge pos-${r.player.position}">${r.player.position}</span></td>
            <td>${r.player.team}${r.player.byeWeek ? ` <span class="tag">bye ${r.player.byeWeek}</span>` : ""}</td>
            <td class="numeric"><strong>${r.scoreResult.score.toFixed(0)}</strong></td>
            <td>${isStarter ? '<span class="tag tag-start">Start</span>' : '<span class="tag tag-bench">Bench</span>'}</td>
          </tr>`;

      const slotsHtml = slotSections
        .map(({ slotDef, starters }) => {
          if (!starters.length) {
            return `<h4>${slotDef.slot}</h4><p class="hint">No eligible player rostered for this slot.</p>`;
          }
          return `<h4>${slotDef.slot}</h4><table class="data-table"><tbody>${starters
            .map((r) => rowHtml(r, true))
            .join("")}</tbody></table>`;
        })
        .join("");

      const benchHtml = bench.length
        ? `<h4>Bench</h4><table class="data-table"><tbody>${bench.map((r) => rowHtml(r, false)).join("")}</tbody></table>`
        : "";

      container.innerHTML = slotsHtml + benchHtml;
    })
    .catch((err) => showErrorBanner("rendering lineup", err));
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
    ["lineup", renderLineup],
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

// --- Roster source (Yahoo / ESPN / local) ------------------------------------------
// Drives both My Roster and Lineup — see shared/roster-source.js for the resolution
// logic and shared/espn-roster.js for why ESPN needs a one-time manual team pick
// (unlike Yahoo, ESPN's API gives the client no way to auto-detect "which team is
// mine").
function initRosterSource() {
  const select = document.getElementById("roster-source-select");
  const refreshBtn = document.getElementById("roster-refresh-btn");
  const espnPicker = document.getElementById("espn-team-picker");
  const espnPickerList = document.getElementById("espn-team-picker-list");
  if (!select) return;

  select.value = getRosterSource();

  async function loadEspnTeamChoices() {
    if (!espnPickerList) return;
    espnPickerList.innerHTML = `<span class="hint">Loading ESPN teams…</span>`;
    try {
      const teams = await getEspnTeams();
      const savedId = getSavedEspnTeamId();
      espnPickerList.innerHTML = teams
        .map(
          (t) =>
            `<button class="btn ${t.id === savedId ? "btn-primary" : "btn-ghost"}" data-team-id="${t.id}" type="button">${t.name}${t.id === savedId ? " ✓" : ""}</button>`
        )
        .join("");
      espnPickerList.querySelectorAll("button[data-team-id]").forEach((btn) => {
        btn.addEventListener(
          "click",
          safe(() => {
            saveEspnTeamId(Number(btn.dataset.teamId));
            clearRosterCache("espn");
            loadEspnTeamChoices();
            renderAll();
          }, "pick ESPN team")
        );
      });
    } catch (err) {
      espnPickerList.innerHTML = `<span class="hint">Couldn't load ESPN teams: ${err.message}</span>`;
    }
  }

  function updateEspnPickerVisibility() {
    if (!espnPicker) return;
    espnPicker.hidden = select.value !== "espn";
    if (!espnPicker.hidden) loadEspnTeamChoices();
  }
  updateEspnPickerVisibility();

  select.addEventListener(
    "change",
    safe(() => {
      setRosterSource(select.value);
      updateEspnPickerVisibility();
      renderAll();
    }, "change roster source")
  );

  if (refreshBtn) {
    refreshBtn.addEventListener(
      "click",
      safe(() =>
        withBusy(refreshBtn, async () => {
          clearRosterCache();
          renderAll();
        }),
        "refresh roster"
      )
    );
  }
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
  initRosterSource();

  const espnBtn = document.getElementById("espn-check-btn");
  espnBtn.addEventListener("click", safe(() => withBusy(espnBtn, checkEspn), "check ESPN connection"));
  // Auto-check on load — ESPN's connection uses server-side env-var credentials (not
  // a per-user login), so there's nothing to wait on the user for; check it the
  // moment the page opens instead of making them click "Test ESPN Connection" first.
  checkEspn().catch((err) => showErrorBanner("check ESPN connection", err));

  const startBtn = document.getElementById("setup-start-btn");
  startBtn.addEventListener(
    "click",
    safe(() => withBusy(startBtn, startDraft), "start draft")
  );

  document.getElementById("setup-reset-btn").addEventListener("click", safe(resetDraft, "reset draft"));
  // Mid-draft reset, visible right on the board itself (the setup-card's reset button
  // is hidden once a draft is active — see refreshSetupVisibility). Confirms first:
  // this wipes every recorded pick with no undo, so a misclick during a live draft
  // must not be able to nuke it silently.
  const boardResetBtn = document.getElementById("board-reset-btn");
  if (boardResetBtn) {
    boardResetBtn.addEventListener(
      "click",
      safe(() => {
        if (window.confirm("Reset this draft? This clears every recorded pick and cannot be undone.")) {
          resetDraft();
        }
      }, "reset draft (board)")
    );
  }
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
