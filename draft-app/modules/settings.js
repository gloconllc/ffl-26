// Settings: scoring tier weights, strategy preset (Recommended / The Brain /
// Custom), and the player-preferences add/remove UI. Every change here affects
// other panels (Available Players, Recommendation, Roster, Lineup) — rather than
// import those panels' render functions directly (which would create a circular
// import, since recommendation.js needs getWeights/getStrategyPreset from here),
// this module just calls notifyAppChange() and lets app.js decide how to re-render.
import { saveJSON, loadJSON } from "../../shared/storage.js";
import { DEFAULT_TIER_WEIGHTS } from "../../shared/scoring-engine.js";
import {
  getPreferences,
  addPlayerPreference,
  removePlayerPreference,
} from "../../shared/preferences.js";
import { safe, escapeHtml, logDebug } from "./dom-utils.js";
import { getCachedPlayers } from "./player-data.js";
import { notifyAppChange } from "../../shared/store.js";

const WEIGHTS_KEY = "tier_weights";
const STRATEGY_KEY = "strategy_preset"; // "recommended" | "brain" | "custom"
const NEED_SLIDER_KEY = "need_awareness_slider"; // 0-100, only meaningful in "custom"

export function getWeights() {
  return loadJSON(WEIGHTS_KEY, DEFAULT_TIER_WEIGHTS);
}

// --- Strategy preset (Settings: "you chose" / "the brain" / "custom") --------------
// The one axis that genuinely reorders recommendations: need-awareness — whether an
// open roster need outranks pure score — is what these three presets control.
export function getStrategyPreset() {
  const preset = loadJSON(STRATEGY_KEY, "recommended");
  return ["recommended", "brain", "custom"].includes(preset) ? preset : "recommended";
}
export function setStrategyPreset(preset) {
  saveJSON(STRATEGY_KEY, preset);
}
export function getNeedAwarenessSlider() {
  const raw = loadJSON(NEED_SLIDER_KEY, 100);
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100;
}
export function setNeedAwarenessSlider(value) {
  const n = Number(value);
  saveJSON(NEED_SLIDER_KEY, Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100);
}
/** Effective 0..1 blend factor for the current preset. 1 = needs always outrank pure
 * score (today's original behavior). 0 = pure score, needs ignored entirely — "the
 * most points at all times no matter what." */
export function effectiveNeedAwareness() {
  const preset = getStrategyPreset();
  if (preset === "brain") return 0;
  if (preset === "custom") return getNeedAwarenessSlider() / 100;
  return 1; // "recommended"
}
export function strategyDescription(preset) {
  if (preset === "brain")
    return "The Brain: pure VORP/tier score, roster needs ignored entirely — the highest-value player wins even at a position you don't need.";
  if (preset === "custom")
    return `Custom: blending needs-awareness at ${getNeedAwarenessSlider()}% (0% = pure Brain, 100% = full Recommended).`;
  return "Recommended: an open roster need always outranks pure score — our default, tuned to build a complete roster.";
}

export function initSettings() {
  const weights = getWeights();
  const sliders = {
    projections: document.getElementById("weight-projections"),
    efficiency: document.getElementById("weight-efficiency"),
    contextual: document.getElementById("weight-contextual"),
    risk: document.getElementById("weight-risk"),
  };
  for (const [key, el] of Object.entries(sliders)) {
    if (!el) continue;
    el.value = Math.round((weights[key] ?? 0) * 100);
    el.addEventListener(
      "input",
      safe(() => {
        const current = getWeights();
        current[key] = Number(el.value) / 100;
        saveJSON(WEIGHTS_KEY, current);
        notifyAppChange();
      }, "adjust tier weight")
    );
  }

  // Strategy preset — three selects (Settings tab, the inline quick-pick on the
  // Recommendation tab, and the Draft Board sidebar) stay in sync since they all
  // read/write the same storage key.
  const presetEls = [
    document.getElementById("strategy-preset"),
    document.getElementById("strategy-preset-inline"),
    document.getElementById("strategy-preset-board"),
  ];
  const needSlider = document.getElementById("need-awareness");

  function syncStrategyUI() {
    const preset = getStrategyPreset();
    presetEls.forEach((el) => el && (el.value = preset));
    if (needSlider) {
      needSlider.value = getNeedAwarenessSlider();
      needSlider.disabled = preset !== "custom";
    }
    const hint = document.getElementById("strategy-inline-hint");
    if (hint) hint.textContent = strategyDescription(preset);
  }

  presetEls.forEach((el) => {
    if (!el) return;
    el.addEventListener(
      "change",
      safe(() => {
        setStrategyPreset(el.value);
        syncStrategyUI();
        notifyAppChange();
      }, "switch strategy")
    );
  });
  if (needSlider) {
    needSlider.addEventListener(
      "input",
      safe(() => {
        setNeedAwarenessSlider(Number(needSlider.value));
        syncStrategyUI();
        notifyAppChange();
      }, "adjust needs-awareness slider")
    );
  }
  syncStrategyUI();
}

// --- Settings: player preferences UI ------------------------------------------
// The preference layer itself (shared/preferences.js, shared/preference-engine.js)
// has been real since early in this project, but nothing in the UI ever let you add
// or remove a stated preference beyond the one hardcoded seed value (Lamar Jackson) —
// so the whole feature was silently inert for anyone whose plans changed, or for the
// ESPN league entirely. This wires the already-exported add/remove functions up to an
// actual form in Settings.
export function renderPreferencesList() {
  const container = document.getElementById("preferences-list");
  if (!container) return;
  const prefs = getPreferences();
  if (!prefs.playerPreferences.length) {
    container.innerHTML = `<p class="hint">No player preferences stated yet.</p>`;
    return;
  }
  container.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Player</th><th>Note</th><th></th></tr></thead>
      <tbody>
        ${prefs.playerPreferences
          .map(
            (p) => `
          <tr>
            <td>${escapeHtml(p.playerName)}</td>
            <td>${escapeHtml(p.note || "")}</td>
            <td><button class="btn btn-ghost btn-pref-remove" data-name="${escapeHtml(p.playerName)}" type="button">Remove</button></td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
  container.querySelectorAll(".btn-pref-remove").forEach((btn) => {
    btn.addEventListener(
      "click",
      safe(() => {
        removePlayerPreference(btn.dataset.name);
        renderPreferencesList();
        // The Recommendation tab's preference layer reads getPreferences() fresh on
        // every render, so removing/adding here must refresh it immediately.
        notifyAppChange();
      }, "remove player preference")
    );
  });
}

export function initPreferencesUI() {
  renderPreferencesList();
  const addBtn = document.getElementById("pref-add-btn");
  const nameInput = document.getElementById("pref-player-name");
  const noteInput = document.getElementById("pref-note");
  if (!addBtn || !nameInput) return;

  addBtn.addEventListener(
    "click",
    safe(() => {
      const playerName = nameInput.value.trim();
      if (!playerName) return;
      // Soft validation only — warn, don't block. The local dataset is known to be
      // missing kickers, team defenses, and 2025 rookies entirely (see the Draft
      // tab's own data-source banner), so a real, intended preference could
      // legitimately not match yet; refusing to save it would just lose the user's
      // input for a gap that's on us, not them.
      const known = getCachedPlayers() || [];
      const matchesKnownPlayer = known.some((p) => p.name.toLowerCase() === playerName.toLowerCase());
      if (!matchesKnownPlayer) {
        logDebug(
          "Player preference added without a dataset match",
          `"${playerName}" doesn't exactly match any player currently loaded — it won't be surfaced on the Recommendation tab until it does (check spelling, or this may be one of the dataset's known gaps: kickers, team defenses, 2025 rookies).`
        );
      }
      addPlayerPreference({
        playerName,
        direction: "for",
        appliesAtPickNumber: null,
        note: noteInput ? noteInput.value.trim() : "",
      });
      nameInput.value = "";
      if (noteInput) noteInput.value = "";
      renderPreferencesList();
      notifyAppChange();
    }, "add player preference")
  );
}
