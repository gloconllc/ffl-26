// ESPN client, browser side. Unlike Yahoo there's no OAuth dance here at all — the
// account owner's SWID/espn_s2 cookies live server-side in Vercel env vars (see
// docs/CONTEXT.md), so from the browser this is just a plain authenticated-feeling GET
// against our own /api/espn/league proxy. Nothing sensitive ever touches this file.

import { API, LEAGUES } from "./data-sources.js";

export async function getEspnLeague(views = ["mSettings"]) {
  const { leagueId, season } = LEAGUES.espn;
  const params = new URLSearchParams({
    season: String(season),
    leagueId,
    views: views.join(","),
  });
  const res = await fetch(`${API.espnLeague}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`ESPN proxy call failed (${res.status}): ${await res.text().catch(() => "")}`);
  }
  return res.json();
}
