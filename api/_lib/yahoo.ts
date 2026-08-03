// Yahoo Fantasy Sports helpers. Server-side only — Yahoo's API has no browser CORS
// support, so every call must go through our /api/yahoo/* endpoints, never straight
// from client-side JS. See docs/DATA_SOURCES.md for the base URLs and docs/CONTEXT.md
// for why this proxy exists at all.
//
// Auth model: this Yahoo app is a Public Client (no client secret — see README.md and
// docs/CONTEXT.md). OAuth uses Authorization Code + PKCE. This module never stores
// tokens itself; it exchanges/refreshes on request and hands the tokens back to the
// caller, who is responsible for persisting them (client-side, in localStorage per our
// architecture decision) and sending the access token back on subsequent calls.

const YAHOO_TOKEN_URL = "https://api.login.yahoo.com/oauth2/get_token";
const YAHOO_FANTASY_BASE = "https://fantasysports.yahooapis.com/fantasy/v2";

function requireClientId(): string {
  const clientId = process.env.YAHOO_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "YAHOO_CLIENT_ID is not set. Add it to .env.local locally, and to the " +
        "Vercel project's Environment Variables once deployed."
    );
  }
  return clientId;
}

export interface YahooTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  xoauth_yahoo_guid?: string;
}

/**
 * Exchange an OAuth authorization code (from the PKCE redirect) for tokens.
 * `redirectUri` must exactly match what's registered in the Yahoo Developer App
 * (locally: https://127.0.0.1/callback — see README.md "Local development").
 */
export async function exchangeCodeForToken(params: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<YahooTokenResponse> {
  const clientId = requireClientId();
  const body = new URLSearchParams({
    client_id: clientId,
    redirect_uri: params.redirectUri,
    code: params.code,
    code_verifier: params.codeVerifier,
    grant_type: "authorization_code",
  });
  return postToken(body);
}

export async function refreshAccessToken(params: {
  refreshToken: string;
  redirectUri: string;
}): Promise<YahooTokenResponse> {
  const clientId = requireClientId();
  const body = new URLSearchParams({
    client_id: clientId,
    redirect_uri: params.redirectUri,
    refresh_token: params.refreshToken,
    grant_type: "refresh_token",
  });
  return postToken(body);
}

async function postToken(body: URLSearchParams): Promise<YahooTokenResponse> {
  const res = await fetch(YAHOO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Yahoo token endpoint returned ${res.status}: ${text}`);
  }
  return (await res.json()) as YahooTokenResponse;
}

/**
 * Generic authenticated read against the Yahoo Fantasy Sports API. `resourcePath`
 * is everything after the base URL, e.g. `league/nfl.l.865803/settings`.
 * Yahoo's default response is XML; we request JSON via `?format=json` since that's
 * far easier for the frontend to consume.
 */
export async function callYahooApi(params: {
  accessToken: string;
  resourcePath: string;
}): Promise<unknown> {
  const separator = params.resourcePath.includes("?") ? "&" : "?";
  const url = `${YAHOO_FANTASY_BASE}/${params.resourcePath}${separator}format=json`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Yahoo API returned ${res.status} for ${params.resourcePath}: ${text}`);
  }
  return res.json();
}
