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
  getMyRoster,
  getRosterNeeds,
  recordPick,
} from "../shared/draft-state.js";
import { pickForOpponent, simulateUntilMyTurn } from "../shared/mock-draft.js";
import { scoreProjectionsTier, DEFAULT_TIER_WEIGHTS } from "../shared/scoring-engine.js";
import { getPreferences, findMatchingPreference } from "../shared/preferences.js";
import { applyPreferenceLayer, acknowledgeOverride } from "../shared/preference-engine.js";

const WEIGHTS_KEY = "tier_weights";
const STRATEGY_KEY = "strategy_preset"; // "recommended" | "brain" | "custom"
const NEED_SLIDER_KEY = "need_awareness_slider"; // 0-100, only meaningful in "custom"

// --- Strategy preset (Settings: "you chose" / "the brain" / "custom") --------------
// The one axis that genuinely reorders recommendations today: with a single scoring
// tier implemented, scaling that tier's own weight can't change ranking order (it
// multiplies every score by the same constant). Need-awareness — whether an open
// roster need outranks pure score — is real and testable, so it's what these three
// presets actually control until Efficiency/Contextual/Risk exist.
function getStrategyPreset() {
  return loadJSON(STRATEGY_KEY, "recommended");
}
function setStrategyPreset(preset) {
  saveJSON(STRATEGY_KEY, preset);
}
function getNeedAwarenessSlider() {
  return loadJSON(NEED_SLIDER_KEY, 100);
}
function setNeedAwarenessSlider(value) {
  saveJSON(NEED_SLIDER_KEY, value);
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
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("is-active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      document.getElementById(`panel-${btn.dataset.panel}`).classList.add("is-active");
    });
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

  document.getElementById("yahoo-connect-btn").addEventListener("click", async () => {
    if (!YAHOO_CLIENT_ID) {
      logDebug("Yahoo connect blocked", "No client ID configured — see shared/config.js");
      setYahooStatus("Missing client ID (see debug output)", "status-error");
      return;
    }
    const url = await yahooAuth.buildAuthUrl(YAHOO_CLIENT_ID);
    location.href = url;
  });
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

// --- Placeholder player data --------------------------------------------------
let cachedPlayers = null;
async function loadPlayers() {
  if (cachedPlayers) return cachedPlayers;
  const res = await fetch("/shared/data/placeholder-players.json");
  if (!res.ok) throw new Error(`Failed to load placeholder player data (${res.status})`);
  const data = await res.json();
  cachedPlayers = data.players;
  return cachedPlayers;
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
    el.addEventListener("input", () => {
      const current = getWeights();
      current[key] = Number(el.value) / 100;
      saveJSON(WEIGHTS_KEY, current);
      renderAvailablePlayers();
      renderRecommendation();
    });
  }

  // Strategy preset — two selects (Settings tab + the inline quick-pick on the
  // Recommendation tab) stay in sync since they read/write the same storage key.
  const presetEls = [
    document.getElementById("strategy-preset"),
    document.getElementById("strategy-preset-inline"),
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
    el.addEventListener("change", () => {
      setStrategyPreset(el.value);
      syncStrategyUI();
      renderAvailablePlayers();
      renderRecommendation();
    });
  });
  if (needSlider) {
    needSlider.addEventListener("input", () => {
      setNeedAwarenessSlider(Number(needSlider.value));
      syncStrategyUI();
      renderRecommendation();
    });
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
      <td><span class="pos-badge">${player ? player.position : "?"}</span></td>
    `;
    tbody.appendChild(tr);
  }
}

// --- Rendering: Available Players ------------------------------------------------
function scoredAvailable(state) {
  const available = getAvailablePlayers(state);
  return available
    .map((p) => ({
      player: p,
      scoreResult: scoreProjectionsTier(p, available, {
        numTeams: state.numTeams,
        startersPerTeamByPosition: { QB: 1, RB: 2.5, WR: 2.5, TE: 1, K: 1, DEF: 1 },
      }),
    }))
    .sort((a, b) => b.scoreResult.score - a.scoreResult.score);
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

  const mine = isMyPick(state);
  for (const { player, scoreResult } of ranked.slice(0, 60)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${player.name}</td>
      <td><span class="pos-badge">${player.position}</span></td>
      <td>${player.team}</td>
      <td>Tier ${scoreResult.tier ?? "?"}</td>
      <td>${scoreResult.vorp.toFixed(1)}</td>
      <td><button class="btn btn-primary btn-draft" data-player="${player.providerPlayerId}" ${mine ? "" : "disabled"}>Draft</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".btn-draft").forEach((btn) => {
    btn.addEventListener("click", () => draftPlayer(btn.dataset.player));
  });
}

function draftPlayer(providerPlayerId) {
  const state = getDraftState();
  if (!state || !isMyPick(state)) return;
  recordPick(state, providerPlayerId, "manual");
  renderAll();
}

// --- Rendering: Recommendation ----------------------------------------------------
function renderRecommendation() {
  const container = document.getElementById("recommendation-content");
  const prefContainer = document.getElementById("preference-layer-content");
  const state = getDraftState();
  if (!state) {
    container.innerHTML = `<p class="hint">Start a draft on the Draft Board tab first.</p>`;
    if (prefContainer) prefContainer.innerHTML = "";
    return;
  }

  if (!isMyPick(state)) {
    const pickNum = currentPickNumber(state);
    const { teamSlot, round } = teamSlotForPick(pickNum, state.numTeams);
    container.innerHTML = `<p class="hint">Waiting — pick ${pickNum} (round ${round}) belongs to Team ${teamSlot}. Use "Simulate to my turn" on the Draft Board tab in practice mode.</p>`;
    if (prefContainer) prefContainer.innerHTML = "";
    return;
  }

  const needs = getRosterNeeds(state, state.myTeamSlot);
  const neededPositions = new Set(needs.flatMap((n) => n.eligiblePositions));
  const scored = scoredAvailable(state);

  const preset = getStrategyPreset();
  const needAwareness = effectiveNeedAwareness();
  const ranked = sortByStrategy(scored, neededPositions, needAwareness);

  // Show the honest delta between "Recommended" and "The Brain" whenever they'd
  // actually pick differently right now — this is the whole point of the preset
  // selector: see the difference before you commit to a pick, not after.
  const recommendedTop = sortByStrategy(scored, neededPositions, 1)[0];
  const brainTop = sortByStrategy(scored, neededPositions, 0)[0];
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
    top3
      .map(({ player, scoreResult }, i) => {
        const cliff =
          scoreResult.remainingInTier !== null && scoreResult.remainingInTier <= 1
            ? `<li class="cliff-warning">⚠ ${scoreResult.reasoning[scoreResult.reasoning.length - 1]}</li>`
            : "";
        const reasoningItems = scoreResult.reasoning
          .slice(0, cliff ? -1 : undefined)
          .map((r) => `<li>${r}</li>`)
          .join("");
        return `
          <div class="rec-card rank-${i + 1}">
            <h4>#${i + 1} ${player.name} <span class="pos-badge">${player.position}</span> — ${player.team}</h4>
            <ul>${reasoningItems}${cliff}</ul>
            <button class="btn btn-primary btn-draft" data-player="${player.providerPlayerId}">Draft this player</button>
          </div>
        `;
      })
      .join("");

  container.querySelectorAll(".btn-draft").forEach((btn) => {
    btn.addEventListener("click", () => draftPlayer(btn.dataset.player));
  });

  renderPreferenceLayer(ranked);
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

  container.querySelectorAll(".btn-draft").forEach((btn) => {
    btn.addEventListener("click", () => draftPlayer(btn.dataset.player));
  });
  container.querySelectorAll(".btn-draft-override").forEach((btn) => {
    btn.addEventListener("click", () => {
      logDebug("Preference override", acknowledgeOverride(btn.dataset.name));
      draftPlayer(btn.dataset.player);
    });
  });
}

// --- Rendering: My Roster -----------------------------------------------------------
function renderRoster() {
  const container = document.getElementById("roster-content");
  const state = getDraftState();
  if (!state) {
    container.innerHTML = `<p class="hint">Start a draft on the Draft Board tab first.</p>`;
    return;
  }

  const roster = getMyRoster(state);
  const needs = getRosterNeeds(state, state.myTeamSlot);

  const rosterRows = roster
    .map((p) => `<tr><td>${p.name}</td><td><span class="pos-badge">${p.position}</span></td><td>${p.team}</td></tr>`)
    .join("");
  const needsText = needs.length
    ? needs.map((n) => `${n.slot} (${n.remaining} open)`).join(", ")
    : "All starting slots filled.";

  container.innerHTML = `
    <p class="hint"><strong>Open needs:</strong> ${needsText}</p>
    <table class="data-table">
      <thead><tr><th>Player</th><th>Pos</th><th>Team</th></tr></thead>
      <tbody>${rosterRows || `<tr><td colspan="3">No picks yet.</td></tr>`}</tbody>
    </table>
  `;
}

function renderAll() {
  renderBoard();
  renderAvailablePlayers();
  renderRecommendation();
  renderRoster();
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
  initTheme();
  initTabs();
  initYahoo();
  initSettings();
  document.getElementById("espn-check-btn").addEventListener("click", checkEspn);
  document.getElementById("setup-start-btn").addEventListener("click", () => {
    startDraft().catch((err) => logDebug("Failed to start draft", String(err)));
  });
  document.getElementById("setup-reset-btn").addEventListener("click", resetDraft);
  document.getElementById("position-filter").addEventListener("change", renderAvailablePlayers);
  document.getElementById("live-sync-btn").addEventListener("click", handleLiveSync);
  document.getElementById("simulate-btn").addEventListener("click", () => {
    const state = getDraftState();
    if (!state) return;
    simulateUntilMyTurn(state, isMyPick);
    renderAll();
  });

  refreshSetupVisibility();
  renderAll();
  logDebug("App booted", { leagues: LEAGUES });
}

main();
