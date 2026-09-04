// App chrome: theme toggle, tab navigation, and the league switcher in the app bar.
// Self-contained — no dependency on draft state or any panel's rendering.
import { saveJSON, loadJSON } from "../../shared/storage.js";
import { setRosterSource, getRosterSource } from "../../shared/roster-source.js";
import { notifyAppChange } from "../../shared/store.js";
import { safe } from "./dom-utils.js";

const THEME_KEY = "theme";
const TAB_KEY = "active_tab";
const LEAGUE_KEY = "active_league";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const toggle = document.getElementById("theme-toggle");
  if (toggle) toggle.textContent = theme === "light" ? "☀" : "☾";
}

export function initTheme() {
  // Light is the default here on purpose — it matches how every mainstream fantasy
  // platform reads, and dark stays one click away for anyone who prefers it.
  const saved = loadJSON(THEME_KEY, "light");
  applyTheme(saved);
  const toggle = document.getElementById("theme-toggle");
  if (!toggle) return;
  toggle.addEventListener(
    "click",
    safe(() => {
      const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      saveJSON(THEME_KEY, next);
      applyTheme(next);
      // The chart reads its colors from CSS variables, so it has to be redrawn for a
      // theme switch to actually take effect on it.
      notifyAppChange();
    }, "toggle theme")
  );
}

function activateTab(panelName) {
  const tabButtons = document.querySelectorAll(".tab-btn");
  const target = document.getElementById(`panel-${panelName}`);
  if (!target) return false;
  tabButtons.forEach((b) => b.classList.toggle("is-active", b.dataset.panel === panelName));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("is-active", p === target));
  return true;
}

export function initTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  tabButtons.forEach((btn) => {
    btn.addEventListener(
      "click",
      safe(() => {
        if (activateTab(btn.dataset.panel)) saveJSON(TAB_KEY, btn.dataset.panel);
      }, "switch tab")
    );
  });

  // Come back to the tab you were on. During a live draft, a stray refresh should not
  // dump you back on a landing screen with the draft board a click away.
  const saved = loadJSON(TAB_KEY, null);
  if (saved) activateTab(saved);
}

/** The league switcher in the app bar is not decorative — clicking a league points the
 * My Team and Lineup tabs at that league's live roster, which is the one piece of
 * state that genuinely differs between the two leagues today. The highlighted league
 * is tracked separately from the roster source, so choosing "this draft (local)" on
 * the My Team tab doesn't blank out the app bar — it just means you're looking at
 * local draft data within that league's context. */
export function initLeagueSwitch() {
  const buttons = document.querySelectorAll(".league-btn");
  if (!buttons.length) return;

  function sync() {
    // If the roster source is pointed at a real league, that always wins — otherwise
    // fall back to the last league the user explicitly chose.
    const source = getRosterSource();
    const active = source === "yahoo" || source === "espn" ? source : loadJSON(LEAGUE_KEY, "yahoo");
    buttons.forEach((b) => b.classList.toggle("is-active", b.dataset.league === active));
  }

  buttons.forEach((btn) => {
    btn.addEventListener(
      "click",
      safe(() => {
        saveJSON(LEAGUE_KEY, btn.dataset.league);
        setRosterSource(btn.dataset.league);
        const select = document.getElementById("roster-source-select");
        if (select) {
          select.value = btn.dataset.league;
          select.dispatchEvent(new Event("change"));
        }
        sync();
        notifyAppChange();
      }, "switch league")
    );
  });

  sync();
}
