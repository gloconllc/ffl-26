// Draft setup/lifecycle: starting a draft, resetting it, the setup-card's
// show/hide logic, live-sync stub, and the "simulate to my turn" practice-mode
// button. This is the one module allowed to import renderAvailablePlayers
// directly from recommendation.js (a one-directional dependency — recommendation.js
// never imports this file back) because the position filter needs an immediate,
// single-panel re-render rather than a full notifyAppChange() sweep.
import {
  initDraftState,
  getDraftState,
  clearDraftState,
  isMyPick,
} from "../../shared/draft-state.js";
import { DEFAULT_ROSTER_SLOTS } from "../../shared/data-sources.js";
import { simulateUntilMyTurn } from "../../shared/mock-draft.js";
import { notifyAppChange } from "../../shared/store.js";
import { safe, withBusy, logDebug } from "./dom-utils.js";
import { loadPlayers, updateDataSourceBanner, loadTeamContext } from "./player-data.js";
import { clearScoredAvailableCache, renderAvailablePlayers } from "./recommendation.js";

export function refreshSetupVisibility() {
  const state = getDraftState();
  const setupCard = document.getElementById("setup-card");
  const boardContent = document.getElementById("board-content");
  const liveSyncBtn = document.getElementById("live-sync-btn");
  if (setupCard) setupCard.hidden = Boolean(state);
  if (boardContent) boardContent.hidden = !state;
  if (liveSyncBtn) liveSyncBtn.hidden = !(state && state.mode === "live");
}

export async function startDraft() {
  const numTeams = Number(document.getElementById("setup-teams").value);
  const myTeamSlot = Number(document.getElementById("setup-slot").value);
  const mode = document.getElementById("setup-mode").value;
  const players = await loadPlayers();
  updateDataSourceBanner();
  await loadTeamContext();

  initDraftState({
    numTeams,
    myTeamSlot,
    mode,
    rosterSlots: DEFAULT_ROSTER_SLOTS,
    players,
  });

  refreshSetupVisibility();
  notifyAppChange();
}

export function resetDraft() {
  clearDraftState();
  clearScoredAvailableCache();
  refreshSetupVisibility();
  notifyAppChange();
}

// --- Live sync (see shared/live-sync.js — real structure, unverified against a real
// live draft yet, see docs/DATA_SOURCES.md) -----------------------------------------
export async function handleLiveSync() {
  logDebug(
    "Live sync",
    "live-sync.js needs a real Yahoo/ESPN draftresults payload shape before this can " +
      "actually map picks — not wired to a button action yet. See shared/live-sync.js TODOs."
  );
}

/** Wires every draft-lifecycle control. Call once at boot. */
export function wireDraftLifecycle() {
  const startBtn = document.getElementById("setup-start-btn");
  if (startBtn) {
    startBtn.addEventListener(
      "click",
      safe(() => withBusy(startBtn, startDraft), "start draft")
    );
  }

  const setupResetBtn = document.getElementById("setup-reset-btn");
  if (setupResetBtn) {
    setupResetBtn.addEventListener("click", safe(resetDraft, "reset draft"));
  }

  // Mid-draft reset, visible right on the board itself (the setup-card's reset button
  // is hidden once a draft is active — see refreshSetupVisibility). Confirms first:
  // this wipes every recorded pick with no undo, so a misclick during a live draft
  // must not be able to nuke it silently.
  const boardResetBtn = document.getElementById("board-reset-btn");
  if (boardResetBtn) {
    boardResetBtn.addEventListener(
      "click",
      safe(() => {
        if (window.confirm("Reset this draft? This clears every recorded pick and cannot be undone.")) {
          resetDraft();
        }
      }, "reset draft (board)")
    );
  }

  const positionFilter = document.getElementById("position-filter");
  if (positionFilter) {
    positionFilter.addEventListener("change", safe(renderAvailablePlayers, "filter players"));
  }

  const liveSyncBtn = document.getElementById("live-sync-btn");
  if (liveSyncBtn) {
    liveSyncBtn.addEventListener("click", safe(handleLiveSync, "live sync"));
  }

  const simulateBtn = document.getElementById("simulate-btn");
  if (simulateBtn) {
    simulateBtn.addEventListener(
      "click",
      safe(
        () =>
          withBusy(simulateBtn, async () => {
            const state = getDraftState();
            if (!state) return;
            // Yield one frame first so the button's busy state actually paints before
            // the (synchronous, can take a moment with many mock picks) simulation runs.
            await new Promise((resolve) => setTimeout(resolve, 0));
            simulateUntilMyTurn(state, isMyPick);
            notifyAppChange();
          }),
        "simulate to my turn"
      )
    );
  }
}
