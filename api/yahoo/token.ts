import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exchangeCodeForToken, refreshAccessToken } from "../_lib/yahoo";

// POST /api/yahoo/token
// Body: { grantType: "authorization_code", code, codeVerifier, redirectUri }
//    or { grantType: "refresh_token", refreshToken, redirectUri }
//
// Returns Yahoo's token response as-is. The client is responsible for storing
// access_token/refresh_token (localStorage, per docs/CONTEXT.md) and calling this
// endpoint again with grantType "refresh_token" once access_token expires
// (expires_in is seconds, typically 3600).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST" });
  }

  // Previously forwarded whatever the client sent straight into URLSearchParams with
  // no presence/type check — a missing field became the literal string "undefined" in
  // the request to Yahoo, which Yahoo then rejected with an opaque error surfaced to
  // the user as a generic 502. Validating here means a real client bug (or a stale/
  // corrupted localStorage value) fails fast with a message that actually says what's
  // wrong, instead of only being diagnosable by inspecting Yahoo's raw error body.
  function requireStrings(obj: Record<string, unknown>, fields: string[]): string | null {
    for (const f of fields) {
      if (typeof obj[f] !== "string" || !obj[f]) return f;
    }
    return null;
  }

  try {
    const body = req.body ?? {};
    if (body.grantType === "authorization_code") {
      const missing = requireStrings(body, ["code", "codeVerifier", "redirectUri"]);
      if (missing) {
        return res.status(400).json({ error: `Missing or invalid required field: "${missing}"` });
      }
      const tokens = await exchangeCodeForToken({
        code: body.code,
        codeVerifier: body.codeVerifier,
        redirectUri: body.redirectUri,
      });
      return res.status(200).json(tokens);
    }
    if (body.grantType === "refresh_token") {
      const missing = requireStrings(body, ["refreshToken", "redirectUri"]);
      if (missing) {
        return res.status(400).json({ error: `Missing or invalid required field: "${missing}"` });
      }
      const tokens = await refreshAccessToken({
        refreshToken: body.refreshToken,
        redirectUri: body.redirectUri,
      });
      return res.status(200).json(tokens);
    }
    return res.status(400).json({
      error: 'body.grantType must be "authorization_code" or "refresh_token"',
    });
  } catch (err) {
    console.error("[api/yahoo/token]", err);
    return res.status(502).json({ error: (err as Error).message });
  }
}
