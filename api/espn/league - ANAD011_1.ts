import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getEspnLeague } from "../_lib/espn";

// GET /api/espn/league?season=2026&leagueId=647918841&views=mRoster,mTeam
//
// No client-supplied auth needed — this ESPN league is a single personal account, so
// SWID/espn_s2 live server-side in env vars (see docs/CONTEXT.md before changing this;
// if this app ever needs to support someone else's ESPN login, that assumption breaks
// and this needs a real per-user auth model instead).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Use GET" });
  }

  const season = Number(req.query.season);
  const leagueId = req.query.leagueId;
  const viewsParam = req.query.views;

  if (!season || typeof leagueId !== "string") {
    return res.status(400).json({ error: "Missing/invalid ?season= or ?leagueId=" });
  }

  const views =
    typeof viewsParam === "string" && viewsParam.length > 0
      ? viewsParam.split(",")
      : ["mSettings"];

  try {
    const data = await getEspnLeague({ season, leagueId, views });
    return res.status(200).json(data);
  } catch (err) {
    console.error("[api/espn/league]", err);
    return res.status(502).json({ error: (err as Error).message });
  }
}
