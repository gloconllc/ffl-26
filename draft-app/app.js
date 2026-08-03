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

const WEIGHTS_KEY = "tier_weights";

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
  const state = getDraftState();
  if (!state) {
    container.innerHTML = `<p class="hint">Start a draft on the Draft Board tab first.</p>`;
    return;
  }

  if (!isMyPick(state)) {
    const pickNum = currentPickNumber(state);
    const { teamSlot, round } = teamSlotForPick(pickNum, state.numTeams);
    container.innerHTML = `<p class="hint">Waiting — pick ${pickNum} (round ${round}) belongs to Team ${teamSlot}. Use "Simulate to my turn" on the Draft Board tab in practice mode.</p>`;
    return;
  }

  const needs = getRosterNeeds(state, state.myTeamSlot);
  const neededPositions = new Set(needs.flatMap((n) => n.eligiblePositions));
  const ranked = scoredAvailable(state);

  // Prefer filling an open starting need among the top-ranked players, same heuristic
  // as the opponent AI (see shared/mock-draft.js) — real need-aware optimization is a
  // deeper problem than a single sort, revisit once Efficiency/Contextual/Risk exist.
  ranked.sort((a, b) => {
    const aNeed = neededPositions.has(a.player.position);
    const bNeed = neededPositions.has(b.player.position);
    if (aNeed !== bNeed) return aNeed ? -1 : 1;
    return b.scoreResult.score - a.scoreResult.score;
  });

  const top3 = ranked.slice(0, 3);
  container.innerHTML = top3
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
