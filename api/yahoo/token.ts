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

  try {
    const body = req.body ?? {};
    if (body.grantType === "authorization_code") {
      const tokens = await exchangeCodeForToken({
        code: body.code,
        codeVerifier: body.codeVerifier,
        redirectUri: body.redirectUri,
      });
      return res.status(200).json(tokens);
    }
    if (body.grantType === "refresh_token") {
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
