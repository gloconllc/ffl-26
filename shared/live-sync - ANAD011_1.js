// Bridges a LIVE Yahoo or ESPN draft into the same draft-state engine practice mode
// uses. This is what makes "tell me who to pick next in real time" possible during
// an actual draft: poll the provider's draft-results endpoint, diff against what our
// local state already knows about, and record any new picks as they happen.
//
// STATUS: real structure, NOT yet verified against a live draft — this sandbox can't
// reach Yahoo/ESPN's real APIs (see docs/DATA_SOURCES.md, "this cloud sandbox cannot
// live-test most of these sources"). Needs to be exercised against a real live/mock
// draft on Yahoo or ESPN (or their draft-lobby practice-draft feature, if they offer
// one) before trusting it on real draft night. Treat pollOnce() as the integration
// point to test first.

import { callYahoo } from "./yahoo-auth.js";
import { getEspnLeague } from "./espn-client.js";
import { recordPick, getDraftState } from "./draft-state.js";
import { LEAGUES } from "./data-sources.js";

/**
 * Fetch the current draft results from Yahoo and translate them into our canonical
 * pick shape. Resource path per Yahoo's docs: league/<league_key>/draftresults.
 * NOTE: Yahoo's league_key is like "449.l.865803" (game_key.l.league_id) — game_key
 * changes per season and isn't just "nfl"; confirm the real value once connected
 * (see docs/CONTEXT.md open questions) rather than trusting this placeholder.
 */
export async function fetchYahooDraftResults(leagueKey) {
  const raw = await callYahoo(`league/${leagueKey}/draftresults`);
  return raw; // TODO: map Yahoo's nested JSON shape into {pickNumber, teamKey, playerKey} once we can see a real payload — see docs/DATA_SOURCES.md
}

/** Fetch current draft detail from ESPN (view=mDraftDetail). */
export async function fetchEspnDraftResults() {
  const raw = await getEspnLeague(["mDraftDetail"]);
  return raw; // TODO: map ESPN's draftDetail.picks[] into our canonical shape once we can see a real payload
}

/**
 * Poll once, record any picks we haven't seen yet, return how many new picks were
 * found. Caller (app.js) is responsible for calling this on an interval during an
 * active live draft and re-rendering after.
 *
 * @param {"yahoo"|"espn"} provider
 * @param {(rawPick:any)=>{providerPlayerId:string}|null} mapPick - translates one
 *   provider-specific pick record into our canonical shape. Left as a caller-supplied
 *   function because we don't have a real payload shape to hardcode against yet —
 *   see the TODOs above.
 */
export async function pollOnce(provider, mapPick) {
  const state = getDraftState();
  if (!state) throw new Error("No draft state initialized — call initDraftState() first.");

  const raw =
    provider === "yahoo"
      ? await fetchYahooDraftResults(LEAGUES.yahoo.leagueKey || LEAGUES.yahoo.leagueId)
      : await fetchEspnDraftResults();

  const rawPicks = Array.isArray(raw?.picks) ? raw.picks : [];
  const alreadySeen = new Set(state.picks.map((p) => p.providerPlayerId));

  let newCount = 0;
  for (const rawPick of rawPicks) {
    const mapped = mapPick(rawPick);
    if (mapped && !alreadySeen.has(mapped.providerPlayerId)) {
      recordPick(state, mapped.providerPlayerId, "live");
      alreadySeen.add(mapped.providerPlayerId);
      newCount++;
    }
  }
  return newCount;
}
