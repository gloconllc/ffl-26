// Non-secret, browser-safe configuration. This Yahoo Client ID is NOT sensitive: the
// app is registered as a Public Client (PKCE, no client secret exists at all — see
// README.md and docs/CONTEXT.md), so the Client ID is meant to be visible in client
// code, the same way any SPA's OAuth client ID is public by design. If this app is
// ever changed to a Confidential Client with a real secret, that secret must NEVER go
// here — it would need to move server-side into api/_lib/yahoo.ts instead.

export const YAHOO_CLIENT_ID =
  "dj0yJmk9TmpJYmFNTVFXS05ZJmQ9WVdrOWQwOUJNWFZTV1VvbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWVh";
