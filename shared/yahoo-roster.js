// Live Yahoo roster fetch — the natural next step after app.js's fetchAndShowMyYahooTeam()
// resolves which team in the league is "mine". Once we have that team's key, Yahoo's
// `team/{team_key}/roster` endpoint returns the actual rostered players.
//
// IMPORTANT CAVEAT: Yahoo's JSON responses are deeply and inconsistently nested (see
// shared/yahoo-auth.js and draft-app/app.js's deepFindYahooTeam for the same issue on
// the "my teams" endpoint) — there is no official schema to code against, only
// observed shapes. This file was written defensively (generic deep search rather than
// a hardcoded path) but has NOT been exercised against a real authenticated response —
// doing that requires the user's own logged-in browser, which isn't available in the
// environment this was written in. The first real call should be treated as a test:
// if getYahooRosterPlayers() throws "couldn't find any roster players", the raw
// response will already be in the debug log (see app.js's logDebug calls at the call
// site) — that's exactly what's needed to fix deepFindYahooPlayers() against the real
// shape quickly.

import { callYahoo } from "./yahoo-auth.js";

function deepFindYahooTeamKey(node) {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFindYahooTeamKey(item);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    if (typeof node.team_key === "string") return node.team_key;
    for (const key of Object.keys(node)) {
      const found = deepFindYahooTeamKey(node[key]);
      if (found) return found;
    }
  }
  return null;
}

/** Collects every object in a Yahoo API response that looks like a player entry.
 * Yahoo player objects carry a `player_key`/`player_id`, a `name` (either a plain
 * string or Yahoo's usual `{full, first, last, ascii_first, ascii_last}` object), and
 * a position field (`display_position` or `primary_position` on roster endpoints). */
export function deepFindYahooPlayers(node, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) deepFindYahooPlayers(item, found);
    return found;
  }
  if (node && typeof node === "object") {
    const hasPlayerId = "player_key" in node || "player_id" in node;
    const name = typeof node.name === "string" ? node.name : node.name?.full;
    const position = node.display_position || node.primary_position || node.position;
    if (hasPlayerId && name && position) {
      found.push({
        name,
        position: String(position).toUpperCase(),
        team: (node.editorial_team_abbr || node.editorial_team_full_name || "").toUpperCase(),
        yahooPlayerId: node.player_id ?? node.player_key,
        source: "yahoo",
      });
    }
    for (const key of Object.keys(node)) deepFindYahooPlayers(node[key], found);
  }
  return found;
}

/** Resolves the logged-in user's team_key within the given Yahoo league. */
export async function findMyYahooTeamKey(leagueId) {
  const leagueKey = `nfl.l.${leagueId}`;
  const data = await callYahoo(
    `users;use_login=1/games;game_keys=nfl/leagues;league_keys=${leagueKey}/teams`
  );
  const teamKey = deepFindYahooTeamKey(data);
  if (!teamKey) {
    const err = new Error(
      "Could not resolve your Yahoo team in this league — the raw response is in the debug log."
    );
    err.rawResponse = data;
    throw err;
  }
  return teamKey;
}

/**
 * Full live roster for the logged-in user's team in the given Yahoo league.
 * @returns {Promise<Array<{name:string, position:string, team:string, yahooPlayerId:string, source:'yahoo'}>>}
 */
export async function getYahooRosterPlayers(leagueId) {
  const teamKey = await findMyYahooTeamKey(leagueId);
  const data = await callYahoo(`team/${teamKey}/roster`);
  const players = deepFindYahooPlayers(data);
  if (!players.length) {
    const err = new Error(
      "Connected to Yahoo and found your team, but couldn't find any roster players in the response — the raw payload is in the debug log to fix the parser against real data."
    );
    err.rawResponse = data;
    throw err;
  }
  return players;
}
