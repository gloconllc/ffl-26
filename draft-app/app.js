import * as yahooAuth from "../shared/yahoo-auth.js";
import { getEspnLeague } from "../shared/espn-client.js";
import { saveJSON, loadJSON } from "../shared/storage.js";
import { LEAGUES } from "../shared/data-sources.js";
import { YAHOO_CLIENT_ID } from "../shared/config.js";

// --- Theme toggle -----------------------------------------------------------
const THEME_KEY = "theme";
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.getElementById("theme-toggle").textContent = theme === "light" ? "☀" : "☾";
}
function initTheme() {
  const saved = loadJSON(THEME_KEY, "dark");
  applyTheme(saved);
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    saveJSON(THEME_KEY, next);
    applyTheme(next);
  });
}

// --- Tab navigation ----------------------------------------------------------
function initTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("is-active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      document.getElementById(`panel-${btn.dataset.panel}`).classList.add("is-active");
    });
  });
}

// --- Debug output helper ------------------------------------------------------
function logDebug(label, data) {
  const el = document.getElementById("debug-output");
  el.hidden = false;
  el.textContent += `\n[${new Date().toISOString()}] ${label}\n${JSON.stringify(data, null, 2)}\n`;
  el.scrollTop = el.scrollHeight;
}

// --- Yahoo connect -------------------------------------------------------------
function setYahooStatus(text, cls) {
  const el = document.getElementById("yahoo-status");
  el.textContent = text;
  el.className = `status ${cls}`;
}

async function initYahoo() {
  const tokens = await yahooAuth.handleRedirectCallback().catch((err) => {
    logDebug("Yahoo redirect callback error", String(err));
    return null;
  });
  if (tokens) logDebug("Yahoo token exchange succeeded", { expires_in: tokens.expires_in });

  if (yahooAuth.isConnected()) {
    setYahooStatus("Connected", "status-connected");
  } else {
    setYahooStatus("Not connected", "status-pending");
  }

  document.getElementById("yahoo-connect-btn").addEventListener("click", async () => {
    if (!YAHOO_CLIENT_ID) {
      logDebug("Yahoo connect blocked", "No client ID injected — see TODO in app.js initYahoo()");
      setYahooStatus("Missing client ID (see debug output)", "status-error");
      return;
    }
    const url = await yahooAuth.buildAuthUrl(YAHOO_CLIENT_ID);
    location.href = url;
  });
}

// --- ESPN connect --------------------------------------------------------------
function setEspnStatus(text, cls) {
  const el = document.getElementById("espn-status");
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

// --- Boot ------------------------------------------------------------------------
function main() {
  initTheme();
  initTabs();
  initYahoo();
  document.getElementById("espn-check-btn").addEventListener("click", checkEspn);
  logDebug("App booted", { leagues: LEAGUES });
}

main();
