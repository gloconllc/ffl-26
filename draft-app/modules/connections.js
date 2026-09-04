// Yahoo + ESPN connection UI. Yahoo is a real OAuth 2.0 + PKCE dance (see
// shared/yahoo-auth.js); ESPN has no per-user login at all — it's server-side
// SWID/espn_s2 cookies configured as Vercel env vars, so from here it's just a
// health-check GET.
import * as yahooAuth from "../../shared/yahoo-auth.js";
import { getEspnLeague } from "../../shared/espn-client.js";
import { LEAGUES } from "../../shared/data-sources.js";
import { YAHOO_CLIENT_ID } from "../../shared/config.js";
import { safe, withBusy, logDebug, showErrorBanner } from "./dom-utils.js";

/** Connection state shows in two places: the full status line on the Connect tab, and
 * a small dot in the app bar's league switcher that's visible from every tab — so you
 * never have to leave the draft to find out whether a league is still connected. */
function setConnDot(id, cls) {
  const dot = document.getElementById(id);
  if (!dot) return;
  dot.className = `conn-dot ${cls}`;
}

function statusToDotClass(cls) {
  if (cls === "status-connected") return "is-ok";
  if (cls === "status-error") return "is-bad";
  return "is-pending";
}

function setYahooStatus(text, cls) {
  const el = document.getElementById("yahoo-status");
  setConnDot("dot-yahoo", statusToDotClass(cls));
  if (!el) return;
  el.textContent = text;
  el.className = `status ${cls}`;
}

/** Yahoo's Fantasy API JSON is deeply and inconsistently nested (numeric-string keys,
 * arrays-of-arrays) depending on the resource — rather than hardcode one exact path
 * (fragile, unverified against a real response), walk the whole tree looking for any
 * object that looks like a team (`name` alongside `team_key`/`team_id`). Works
 * regardless of exactly how deep Yahoo buries it. */
function deepFindYahooTeam(node) {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFindYahooTeam(item);
      if (found) return found;
    }
    return null;
  }
  if (node && typeof node === "object") {
    if (typeof node.name === "string" && ("team_key" in node || "team_id" in node)) {
      return { name: node.name, teamKey: node.team_key ?? null };
    }
    for (const key of Object.keys(node)) {
      const found = deepFindYahooTeam(node[key]);
      if (found) return found;
    }
  }
  return null;
}

/** Confirms the Yahoo connection actually works end-to-end by resolving the user's
 * own team in the league — not just that the OAuth token exchange succeeded. */
async function fetchAndShowMyYahooTeam() {
  const leagueKey = `nfl.l.${LEAGUES.yahoo.leagueId}`;
  try {
    const data = await yahooAuth.callYahoo(
      `users;use_login=1/games;game_keys=nfl/leagues;league_keys=${leagueKey}/teams`
    );
    logDebug("Yahoo 'my teams' raw response", data);
    const team = deepFindYahooTeam(data);
    if (team) {
      setYahooStatus(`Connected — ${team.name}`, "status-connected");
      logDebug("Yahoo team resolved", team);
    } else {
      logDebug(
        "Yahoo connected, but couldn't find a team in the response",
        "See the raw response above — the league may not have started/synced rosters yet, or Yahoo's response shape differs from expected. Connection itself is fine."
      );
    }
  } catch (err) {
    logDebug("Yahoo 'my teams' lookup failed (connection itself still OK)", String(err));
  }
}

async function initYahoo() {
  const tokens = await yahooAuth.handleRedirectCallback().catch((err) => {
    logDebug("Yahoo redirect callback error", String(err));
    return null;
  });
  if (tokens) logDebug("Yahoo token exchange succeeded", { expires_in: tokens.expires_in });

  setYahooStatus(
    yahooAuth.isConnected() ? "Connected" : "Not connected",
    yahooAuth.isConnected() ? "status-connected" : "status-pending"
  );
  if (yahooAuth.isConnected()) fetchAndShowMyYahooTeam();

  const yahooBtn = document.getElementById("yahoo-connect-btn");
  if (!yahooBtn) return;
  yahooBtn.addEventListener(
    "click",
    safe(
      () =>
        withBusy(yahooBtn, async () => {
          if (!YAHOO_CLIENT_ID) {
            logDebug("Yahoo connect blocked", "No client ID configured — see shared/config.js");
            setYahooStatus("Missing client ID (see debug output)", "status-error");
            return;
          }
          const url = await yahooAuth.buildAuthUrl(YAHOO_CLIENT_ID);
          location.href = url;
        }),
      "connect Yahoo"
    )
  );
}

function setEspnStatus(text, cls) {
  const el = document.getElementById("espn-status");
  setConnDot("dot-espn", statusToDotClass(cls));
  if (!el) return;
  el.textContent = text;
  el.className = `status ${cls}`;
}

async function checkEspn() {
  setEspnStatus("Checking…", "status-pending");
  try {
    const data = await getEspnLeague(["mSettings"]);
    logDebug("ESPN league response", data);
    setEspnStatus("Connected", "status-connected");
  } catch (err) {
    logDebug("ESPN connection error", String(err));
    setEspnStatus("Connection failed (see debug output)", "status-error");
  }
}

/** Wires both connection cards and kicks off Yahoo's redirect-callback handling +
 * ESPN's auto health-check. Call once at boot. */
export function initConnections() {
  initYahoo().catch((err) => showErrorBanner("Yahoo init", err));

  const espnBtn = document.getElementById("espn-check-btn");
  if (espnBtn) {
    espnBtn.addEventListener("click", safe(() => withBusy(espnBtn, checkEspn), "check ESPN connection"));
  }
  // Auto-check on load — ESPN's connection uses server-side env-var credentials (not
  // a per-user login), so there's nothing to wait on the user for; check it the
  // moment the page opens instead of making them click "Test ESPN Connection" first.
  checkEspn().catch((err) => showErrorBanner("check ESPN connection", err));
}
