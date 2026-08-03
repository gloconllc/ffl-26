// Yahoo OAuth 2.0 + PKCE, browser side. This app is registered as a Public Client
// (see README.md) so there is no client secret anywhere in this code — only the
// Client ID, which is not highly sensitive by design for a PKCE public client.
//
// Flow: buildAuthUrl() -> redirect to Yahoo -> Yahoo redirects back to
// REDIRECT_URI with ?code=... -> handleRedirectCallback() exchanges it via our
// /api/yahoo/token proxy (Yahoo's token endpoint has no browser CORS support, so this
// step cannot happen directly client-side) -> tokens saved to localStorage.

import { saveJSON, loadJSON } from "./storage.js";
import { API } from "./data-sources.js";

const YAHOO_AUTH_URL = "https://api.login.yahoo.com/oauth2/request_auth";
const TOKEN_STORAGE_KEY = "yahoo_tokens";
const PKCE_STORAGE_KEY = "yahoo_pkce_verifier";

// Must exactly match what's registered in the Yahoo Developer App. README.md
// documents 127.0.0.1 for local dev; add the deployed Vercel URL's own redirect URI
// there too once we have one, and switch this based on location.origin.
function redirectUri() {
  return `${location.origin}/callback`;
}

function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(input) {
  const data = new TextEncoder().encode(input);
  return crypto.subtle.digest("SHA-256", data);
}

function randomString(length = 64) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Builds the Yahoo authorization URL and stashes the PKCE code_verifier in
 * localStorage so handleRedirectCallback() can retrieve it after the redirect.
 * Caller is responsible for navigating the browser to the returned URL.
 */
export async function buildAuthUrl(clientId) {
  const verifier = randomString(64);
  const challenge = base64UrlEncode(await sha256(verifier));
  saveJSON(PKCE_STORAGE_KEY, verifier);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${YAHOO_AUTH_URL}?${params.toString()}`;
}

/**
 * Call this on page load. If the URL has a Yahoo ?code= param, exchanges it for
 * tokens and clears the param from the URL. No-op if there's no code present.
 * Returns the tokens on success, null if there was nothing to do.
 */
export async function handleRedirectCallback() {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  if (!code) return null;

  const codeVerifier = loadJSON(PKCE_STORAGE_KEY);
  if (!codeVerifier) {
    console.error("[yahoo-auth] Got an auth code but no stored PKCE verifier — the flow was interrupted or storage was cleared.");
    return null;
  }

  const res = await fetch(API.yahooToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grantType: "authorization_code",
      code,
      codeVerifier,
      redirectUri: redirectUri(),
    }),
  });
  if (!res.ok) {
    console.error("[yahoo-auth] token exchange failed", await res.text().catch(() => ""));
    return null;
  }
  const tokens = await res.json();
  saveJSON(TOKEN_STORAGE_KEY, { ...tokens, obtainedAt: Date.now() });

  // Clean the ?code= param out of the URL so a refresh doesn't try to reuse it.
  url.searchParams.delete("code");
  history.replaceState({}, "", url.toString());

  return tokens;
}

export function getStoredTokens() {
  return loadJSON(TOKEN_STORAGE_KEY);
}

export function isConnected() {
  return Boolean(getStoredTokens()?.access_token);
}

/**
 * Refresh the access token if it's expired (or about to be). Safe to call before
 * every API request; it's a no-op if the current token still has time left.
 */
export async function ensureFreshToken() {
  const tokens = getStoredTokens();
  if (!tokens) return null;

  const ageSeconds = (Date.now() - tokens.obtainedAt) / 1000;
  const stillFresh = ageSeconds < tokens.expires_in - 60; // 60s safety margin
  if (stillFresh) return tokens;

  const res = await fetch(API.yahooToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grantType: "refresh_token",
      refreshToken: tokens.refresh_token,
      redirectUri: redirectUri(),
    }),
  });
  if (!res.ok) {
    console.error("[yahoo-auth] refresh failed", await res.text().catch(() => ""));
    return null;
  }
  const refreshed = await res.json();
  const merged = { ...refreshed, obtainedAt: Date.now() };
  saveJSON(TOKEN_STORAGE_KEY, merged);
  return merged;
}

/** Authenticated GET against a Yahoo Fantasy resource path, via our /api proxy. */
export async function callYahoo(resourcePath) {
  const tokens = await ensureFreshToken();
  if (!tokens) throw new Error("Not connected to Yahoo yet.");

  const res = await fetch(`${API.yahooProxy}?resource=${encodeURIComponent(resourcePath)}`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!res.ok) {
    throw new Error(`Yahoo proxy call failed (${res.status}): ${await res.text().catch(() => "")}`);
  }
  return res.json();
}
