// Top-level orchestrator. Every panel's rendering lives in draft-app/modules/*.js;
// this file boots each module once and owns renderAll() — the one function that knows
// about every panel — as the single subscriber to shared/store.js's onAppChange event.
// Any module that changes state calls notifyAppChange() rather than importing another
// module's render function, which is what keeps the module graph acyclic.
import { LEAGUES } from "../shared/data-sources.js";
import { onAppChange } from "../shared/store.js";
import { showErrorBanner, logDebug } from "./modules/dom-utils.js";
import { initTheme, initTabs, initLeagueSwitch } from "./modules/theme-tabs.js";
import { loadPlayers, updateDataSourceBanner, loadTeamContext } from "./modules/player-data.js";
import { initConnections } from "./modules/connections.js";
import { initSettings, initPreferencesUI } from "./modules/settings.js";
import { renderBoard } from "./modules/board.js";
import {
  renderAvailablePlayers,
  renderRecommendation,
  renderBoardRecommendation,
  renderBestAvailable,
  initPlayerFilters,
  clearScoredAvailableCache,
} from "./modules/recommendation.js";
import { renderRoster, renderLineup, initRosterSource } from "./modules/roster-lineup.js";
import { refreshSetupVisibility, wireDraftLifecycle } from "./modules/draft-lifecycle.js";
import { renderOverview, clearOverviewCache } from "./modules/overview.js";
import { renderMarkets, initMarkets } from "./modules/markets.js";

/** Run each render function independently — a bug in one panel must never blank out
 * the others (or the whole page). Each failure surfaces via the error banner and that
 * one section keeps its last-good content. */
function renderAll() {
  const sections = [
    ["overview", renderOverview],
    ["draft board", renderBoard],
    ["best available", renderBestAvailable],
    ["available players", renderAvailablePlayers],
    ["recommendation", renderRecommendation],
    ["live board recommendation", renderBoardRecommendation],
    ["roster", renderRoster],
    ["lineup", renderLineup],
    ["markets", renderMarkets],
  ];
  for (const [label, fn] of sections) {
    try {
      fn();
    } catch (err) {
      showErrorBanner(`rendering ${label}`, err);
    }
  }
}

function main() {
  // Last-resort catch-all: anything that throws outside our own try/catches (a browser
  // API, a CDN script, a timer callback) still surfaces here instead of leaving the
  // page looking frozen with no explanation.
  window.addEventListener("error", (event) => {
    showErrorBanner("unexpected error", event.error || event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    showErrorBanner("unexpected error", event.reason);
  });

  const dismissBtn = document.getElementById("error-banner-dismiss");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      document.getElementById("error-banner").hidden = true;
    });
  }

  initTheme();
  initTabs();
  initLeagueSwitch();
  initConnections();
  initSettings();
  initPreferencesUI();
  initRosterSource();
  initPlayerFilters();
  wireDraftLifecycle();
  initMarkets();

  // Every module that mutates shared state calls notifyAppChange(); this is the one
  // place that turns that signal into an actual re-render of every panel.
  onAppChange(renderAll);

  refreshSetupVisibility();
  renderAll();

  loadPlayers()
    .then(() => {
      updateDataSourceBanner();
      // The Overview cheat sheet ranks the full pool, so it can't render anything
      // until the pool actually arrives — this is the render that fills it in.
      clearOverviewCache();
      renderAll();
    })
    .catch((err) => showErrorBanner("loading player data", err));

  // Contextual scoring (schedule/odds) is loaded unconditionally on boot, not only
  // inside startDraft() — otherwise a refresh mid-draft would leave the whole
  // Contextual tier silently neutral for the rest of the session.
  loadTeamContext()
    .then(() => {
      // Both score caches key on picks/weights only — neither knows team context just
      // went from empty to real, so without an explicit clear they'd serve the first
      // render's neutral-context scores forever.
      clearScoredAvailableCache();
      clearOverviewCache();
      renderAll();
    })
    .catch((err) => showErrorBanner("loading team context", err));

  logDebug("App booted", { leagues: LEAGUES });
}

try {
  main();
} catch (err) {
  showErrorBanner("app startup", err);
}
