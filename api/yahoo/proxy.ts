import type { VercelRequest, VercelResponse } from "@vercel/node";
import { callYahooApi } from "../_lib/yahoo";

// GET /api/yahoo/proxy?resource=<yahoo resource path>
// Header: Authorization: Bearer <access_token> (obtained from /api/yahoo/token)
//
// Generic passthrough so we don't need one function per Yahoo resource. Example:
//   /api/yahoo/proxy?resource=league/nfl.l.865803/settings
//   /api/yahoo/proxy?resource=league/nfl.l.865803/draftresults
//   /api/yahoo/proxy?resource=team/nfl.l.865803.t.1/roster
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Use GET" });
  }

  const resource = req.query.resource;
  if (typeof resource !== "string" || resource.length === 0) {
    return res.status(400).json({ error: "Missing ?resource=<yahoo resource path>" });
  }

  const authHeader = req.headers.authorization;
  const accessToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
  if (!accessToken) {
    return res.status(401).json({ error: "Missing Authorization: Bearer <access_token>" });
  }

  try {
    const data = await callYahooApi({ accessToken, resourcePath: resource });
    return res.status(200).json(data);
  } catch (err) {
    console.error("[api/yahoo/proxy]", err);
    return res.status(502).json({ error: (err as Error).message });
  }
}
