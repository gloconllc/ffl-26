// Player pool + team-context loading. Owns the in-memory caches other modules read
// (via the getters below) — this is the ONE place that fetches
// shared/data/players-live.json and shared/data/team-context-2026.json, so every
// panel that needs the player pool or schedule/odds context sees the same data.
import { logDebug } from "./dom-utils.js";

// See scripts/build-player-data.mjs for exactly how players-live.json is built and
// its own _README for the honest caveats (2024-actuals-based projection proxy, not
// an official 2026 projection — no free source for that exists yet).
let cachedPlayers = null;
let cachedTeamContext = null;
let usingPlaceholderData = false;

export function getCachedPlayers() {
  return cachedPlayers;
}
export function getCachedTeamContext() {
  return cachedTeamContext;
}
export function isUsingPlaceholderData() {
  return usingPlaceholderData;
}

export async function loadPlayers() {
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

export function updateDataSourceBanner() {
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

export async function loadTeamContext() {
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
