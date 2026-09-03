// ESPN Fantasy Football helpers. ESPN has no official public Fantasy API — this uses
// the same internal v3 endpoint the ESPN web app itself calls, authenticated with the
// account owner's own SWID/espn_s2 session cookies (the standard community pattern —
// see docs/DATA_SOURCES.md for sources). Server-side only: these cookies must never
// reach client-side JS, so every ESPN read goes through /api/espn/*.

const ESPN_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";

function requireEspnCreds(): { swid: string; s2: string } {
  const swid = process.env.ESPN_SWID;
  const s2 = process.env.ESPN_S2;
  if (!swid || !s2) {
    throw new Error(
      "ESPN_SWID / ESPN_S2 are not set. Add them to .env.local locally, and to the " +
        "Vercel project's Environment Variables once deployed. These are the " +
        "account owner's own ESPN session cookies — see docs/CONTEXT.md before " +
        "changing how they're handled."
    );
  }
  return { swid, s2 };
}

/**
 * Fetch league data for a given season/league/view(s). `views` maps to ESPN's
 * `?view=mRoster&view=mTeam` style query params — pass whichever views the caller
 * actually needs (see docs/DATA_SOURCES.md for the views we've identified so far;
 * confirm exact names empirically, ESPN's internal API is undocumented and has moved
 * before).
 */
export async function getEspnLeague(params: {
  season: number;
  leagueId: string;
  views: string[];
}): Promise<unknown> {
  const { swid, s2 } = requireEspnCreds();
  const viewQuery = params.views.map((v) => `view=${encodeURIComponent(v)}`).join("&");
  const url = `${ESPN_BASE}/${params.season}/segments/0/leagues/${params.leagueId}?${viewQuery}`;
  const res = await fetch(url, {
    headers: {
      // ESPN expects both cookies together; SWID is normally wrapped in curly braces
      // exactly as ESPN issues it (e.g. "{D49E17...-...}").
      Cookie: `SWID=${swid}; espn_s2=${s2}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `ESPN API returned ${res.status} for league ${params.leagueId} (${res.url}): ${text}`
    );
  }
  return res.json();
}
