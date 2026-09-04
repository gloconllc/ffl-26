// Slim top-level orchestrator. Every panel's actual rendering logic now lives in
// draft-app/modules/*.js; this file's only two jobs are (1) booting every module
// once, and (2) owning renderAll() — the one function allowed to know about every
// panel at once — as the single subscriber to shared/store.js's onAppChange event.
// Any module that changes state (settings, roster source, a drafted pick, ...) calls
// notifyAppChange() instead of importing render functions directly; that's what keeps
// the module graph acyclic (see settings.js's doc comment for the concrete case that
// forced this design: settings.js <-> recommendation.js would otherwise be circular).
import { LEAGUES } from "../shared/data-sources.js";
import { onAppChange } from "../shared/store.js";
import { showErrorBanner, safe, withBusy, logDebug } from "./modules/dom-utils.js";
import { initTheme, initTabs } from "./modules/theme-tabs.js";
import { loadPlayers, updateDataSourceBanner, loadTeamContext } from "./modules/player-data.js";
import { initConnections } from "./modules/connections.js";
import { initSettings, initPreferencesUI } from "./modules/settings.js";
import { renderBoard } from "./modules/board.js";
import {
  renderAvailablePlayers,
  renderRecommendation,
  renderBoardRecommendation,
  clearScoredAvailableCache,
} from "./modules/recommendation.js";
import { renderRoster, renderLineup, initRosterSource } from "./modules/roster-lineup.js";
import { refreshSetupVisibility, wireDraftLifecycle } from "./modules/draft-lifecycle.js";

/** Run each render function independently — a bug in one panel's rendering must
 * never blank out the others (or the whole page). Each failure surfaces via the
 * error banner and that one section is left showing its last-good content. */
function renderAll() {
  const sections = [
    ["draft board", renderBoard],
    ["available players", renderAvailablePlayers],
    ["recommendation", renderRecommendation],
    ["live board recommendation", renderBoardRecommendation],
    ["roster", renderRoster],
    ["lineup", renderLineup],
  ];
  for (const [label, fn] of sections) {
    try {
      fn();
    } catch (err) {
      showErrorBanner(`rendering ${label}`, err);
    }
  }
}

// --- Boot ------------------------------------------------------------------------
function main() {
  // Last-resort catch-all: anything that throws outside our own try/catches (a
  // browser API, a CDN script like Chart.js, a timer callback) still surfaces here
  // instead of leaving the page looking frozen with no explanation.
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
  initConnections();
  initSettings();
  initPreferencesUI();
  initRosterSource();
  wireDraftLifecycle();

  // Every module that mutates shared state calls notifyAppChange() instead of
  // rendering directly — this is the one place that turns that signal into an
  // actual re-render of every panel.
  onAppChange(renderAll);

  refreshSetupVisibility();
  renderAll();
  loadPlayers()
    .then(updateDataSourceBanner)
    .catch((err) => showErrorBanner("loading player data", err));
  // Contextual scoring (schedule/odds) was previously only ever loaded from inside
  // startDraft() — fine for starting a fresh draft, but it meant a page refresh
  // mid-draft (existing state, startDraft() never called again) left team context
  // null for the rest of the session, silently going neutral on the whole Contextual
  // tier with no visible sign anything was wrong. Load it unconditionally on boot too,
  // and re-render once it's in so an already-visible board/recommendation/lineup picks
  // up real context instead of staying neutral until the next full page action.
  loadTeamContext()
    .then(() => {
      // scoredAvailable()'s memoization cache is keyed only on picks.length + weights
      // — it has no idea team context just went from null to real data, so without an
      // explicit clear here, this render would silently keep serving the FIRST
      // render's already-cached (neutral-context) scores forever, defeating the whole
      // point of this fix. Loading team context is the one event that can change
      // scores without picks.length or weights changing, so it's the one place
      // besides those that must invalidate the cache.
      clearScoredAvailableCache();
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
