// Live ESPN roster fetch, for the "later have the ability to show ESPN's too" half of
// roster sync. Two things make this different from the Yahoo version:
//
// 1. ESPN's mRoster/mTeam views encode position and pro team as small integers, not
//    names — the tables below are the standard, publicly documented ESPN Fantasy
//    mapping (stable across seasons, used by essentially every open-source ESPN
//    fantasy tool). Not verified against a live response in this session — ESPN's
//    connection is still unresolved (see ESPN_SWID/ESPN_S2 env var issue) and this
//    league hasn't drafted yet, so there's no real roster to test against until then.
//
// 2. Unlike Yahoo (which has a "use_login=1" trick to resolve "my team" directly),
//    ESPN's API has no equivalent the client can use — the server-side SWID/espn_s2
//    cookies are never exposed to the browser (by design, see api/_lib/espn.ts), so
//    there's no client-side way to match "which team is mine" automatically. Instead,
//    the user picks their team once from the league's team list (see
//    getEspnTeams/pickEspnMyTeam below); that choice is remembered in localStorage.

import { API, LEAGUES } from "./data-sources.js";
import { saveJSON, loadJSON } from "./storage.js";

const MY_TEAM_KEY = "espn_my_team_id";

// Standard ESPN Fantasy defaultPositionId -> our position codes.
const ESPN_POSITION_MAP = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DEF",
};

// Standard ESPN Fantasy proTeamId -> NFL team abbreviation.
const ESPN_TEAM_MAP = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN", 8: "DET",
  9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR", 15: "MIA", 16: "MIN",
  17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI", 22: "ARI", 23: "PIT", 24: "LAC",
  25: "SF", 26: "SEA", 27: "TB", 28: "WSH", 29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};

async function fetchEspnView(views) {
  const url = `${API.espnLeague}?season=${LEAGUES.espn.season}&leagueId=${LEAGUES.espn.leagueId}&views=${views}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ESPN proxy call failed (${res.status}): ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

/** List of {id, name} for every team in the league — used to let the user pick which
 * one is theirs (see module doc comment for why this can't be auto-detected). */
export async function getEspnTeams() {
  const data = await fetchEspnView("mTeam");
  const teams = data?.teams;
  if (!Array.isArray(teams) || !teams.length) {
    const err = new Error("Connected to ESPN, but the response had no teams — the league may not be set up yet.");
    err.rawResponse = data;
    throw err;
  }
  return teams.map((t) => ({
    id: t.id,
    name: t.name || `${t.location || ""} ${t.nickname || ""}`.trim() || `Team ${t.id}`,
  }));
}

export function getSavedEspnTeamId() {
  return loadJSON(MY_TEAM_KEY, null);
}

export function saveEspnTeamId(teamId) {
  saveJSON(MY_TEAM_KEY, teamId);
}

/**
 * Full roster for a specific ESPN team ID (see getSavedEspnTeamId/saveEspnTeamId for
 * how "my team" is chosen and remembered).
 * @returns {Promise<Array<{name:string, position:string, team:string, espnPlayerId:number, source:'espn'}>>}
 */
export async function getEspnRosterForTeam(teamId) {
  const data = await fetchEspnView("mRoster");
  const team = data?.teams?.find((t) => t.id === teamId);
  if (!team) {
    const err = new Error(`ESPN team id ${teamId} not found in this league's response.`);
    err.rawResponse = data;
    throw err;
  }
  const entries = team?.roster?.entries;
  if (!Array.isArray(entries) || !entries.length) {
    const err = new Error("Found your ESPN team, but it has no roster entries yet — your league may not have drafted.");
    err.rawResponse = data;
    throw err;
  }
  return entries.map((entry) => {
    const player = entry.playerPoolEntry?.player || entry.player || {};
    return {
      name: player.fullName || `${player.firstName || ""} ${player.lastName || ""}`.trim(),
      position: ESPN_POSITION_MAP[player.defaultPositionId] || "UNKNOWN",
      team: ESPN_TEAM_MAP[player.proTeamId] || "",
      espnPlayerId: player.id,
      source: "espn",
    };
  });
}

/** Convenience: full flow using the saved team choice. Throws a clear, actionable
 * error if no team has been picked yet (caller should prompt via getEspnTeams()). */
export async function getMyEspnRoster() {
  const teamId = getSavedEspnTeamId();
  if (teamId == null) {
    throw new Error("No ESPN team selected yet — pick your team first (see the Roster tab's ESPN source option).");
  }
  return getEspnRosterForTeam(teamId);
}
