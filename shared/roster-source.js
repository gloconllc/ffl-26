// Unifies "what is my current roster" across three possible sources: the local
// practice-mode draft log (shared/draft-state.js), a live Yahoo roster fetch, or a
// live ESPN roster fetch — so My Roster and the Lineup tab don't each need their own
// copy of this logic. The user picks a source (persisted); Yahoo/ESPN results are
// cached in memory only (cleared on explicit refresh or page reload) since they
// require a network round-trip and shouldn't be re-fetched on every render.

import { saveJSON, loadJSON } from "./storage.js";
import { LEAGUES } from "./data-sources.js";
import { getMyRoster as getLocalDraftRoster } from "./draft-state.js";
import { getYahooRosterPlayers } from "./yahoo-roster.js";
import { getMyEspnRoster, getSavedEspnTeamId } from "./espn-roster.js";
import { matchPlayerToLocalDataset } from "./player-match.js";
import * as yahooAuth from "./yahoo-auth.js";

const SOURCE_KEY = "roster_source"; // "local" | "yahoo" | "espn"

export function getRosterSource() {
  const saved = loadJSON(SOURCE_KEY, "local");
  return ["local", "yahoo", "espn"].includes(saved) ? saved : "local";
}

export function setRosterSource(source) {
  saveJSON(SOURCE_KEY, source);
}

let cache = { yahoo: null, espn: null }; // { players, unmatched, fetchedAt }

export function clearRosterCache(source) {
  if (source) cache[source] = null;
  else cache = { yahoo: null, espn: null };
}

function mapExternalRoster(externalPlayers, localPlayers) {
  const players = [];
  const unmatched = [];
  for (const ext of externalPlayers) {
    const match = matchPlayerToLocalDataset(ext, localPlayers);
    if (match) players.push(match);
    else unmatched.push(ext);
  }
  return { players, unmatched };
}

/**
 * Resolves "my roster" per the current source preference.
 * @param {object|null} draftState - result of getDraftState(), for the "local" source
 *   and as a fallback when a live source fails.
 * @param {Array} localPlayers - the canonical player pool, for matching external names.
 * @param {{forceRefresh?: boolean}} [opts]
 * @returns {Promise<{source: string, players: Array, unmatched: Array, warning: string|null}>}
 */
export async function resolveMyRoster(draftState, localPlayers, opts = {}) {
  const source = getRosterSource();

  if (source === "local") {
    const players = draftState ? getLocalDraftRoster(draftState) : [];
    return { source: "local", players, unmatched: [], warning: null };
  }

  if (source === "yahoo") {
    if (!yahooAuth.isConnected()) {
      return fallbackToLocal(draftState, "Yahoo isn't connected — showing your local draft log instead.");
    }
    if (!opts.forceRefresh && cache.yahoo) {
      return { ...cache.yahoo, source: "yahoo" };
    }
    try {
      const external = await getYahooRosterPlayers(LEAGUES.yahoo.leagueId);
      const { players, unmatched } = mapExternalRoster(external, localPlayers);
      const warning = unmatched.length
        ? `${unmatched.length} Yahoo player(s) couldn't be matched to the local dataset: ${unmatched.map((p) => p.name).join(", ")}.`
        : null;
      cache.yahoo = { players, unmatched, warning };
      return { source: "yahoo", players, unmatched, warning };
    } catch (err) {
      return fallbackToLocal(draftState, `Yahoo roster fetch failed (${err.message}) — showing your local draft log instead.`);
    }
  }

  if (source === "espn") {
    if (getSavedEspnTeamId() == null) {
      return fallbackToLocal(draftState, "No ESPN team selected yet — pick your team in the Roster tab, showing your local draft log for now.");
    }
    if (!opts.forceRefresh && cache.espn) {
      return { ...cache.espn, source: "espn" };
    }
    try {
      const external = await getMyEspnRoster();
      const { players, unmatched } = mapExternalRoster(external, localPlayers);
      const warning = unmatched.length
        ? `${unmatched.length} ESPN player(s) couldn't be matched to the local dataset: ${unmatched.map((p) => p.name).join(", ")}.`
        : null;
      cache.espn = { players, unmatched, warning };
      return { source: "espn", players, unmatched, warning };
    } catch (err) {
      return fallbackToLocal(draftState, `ESPN roster fetch failed (${err.message}) — showing your local draft log instead.`);
    }
  }

  return fallbackToLocal(draftState, null);
}

function fallbackToLocal(draftState, warning) {
  const players = draftState ? getLocalDraftRoster(draftState) : [];
  return { source: "local", players, unmatched: [], warning };
}
