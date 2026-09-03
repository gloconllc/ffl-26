// User-stated preferences, persisted. This is the actual data the personal
// preference layer (shared/preference-engine.js) reconciles against the model's
// picks — see docs/CONTEXT.md "Draft position + strategy philosophy" for the
// real facts these are seeded from (2026-08-03).

import { saveJSON, loadJSON } from "./storage.js";

const PREFS_KEY = "user_preferences";

const SEED_PREFERENCES = {
  draftSlots: {
    yahoo: 1, // confirmed: pick 1 overall
    espn: null, // "3rd or 4th, not sure" — user needs to confirm before that draft
  },
  strategy: {
    style: "aggressive",
    note:
      "Goal is to finish the season strong, not just start hot — history of fading " +
      "late. This should eventually weight the Contextual tier's playoff-schedule " +
      "factor once that tier is real, not just early-season value.",
  },
  positionalBias: {
    position: "RB",
    strength: "heavy",
    note:
      "Historically RB-heavy by preference (\"I like the consistency\"), but WR (and " +
      "QB) have been scoring heavily lately. Explicit instruction: the model should " +
      "NOT defer to this bias — surface the data-driven pick honestly even when it " +
      "disagrees with this preference.",
  },
  playerPreferences: [
    {
      playerName: "Lamar Jackson",
      direction: "for",
      appliesAtPickNumber: 1,
      note: "Plan is to draft him first overall (Yahoo) and build the roster around him, same as prior seasons.",
    },
  ],
};

export function getPreferences() {
  return loadJSON(PREFS_KEY, SEED_PREFERENCES);
}

export function savePreferences(prefs) {
  saveJSON(PREFS_KEY, prefs);
}

export function addPlayerPreference(pref) {
  const prefs = getPreferences();
  prefs.playerPreferences.push(pref);
  savePreferences(prefs);
  return prefs;
}

export function removePlayerPreference(playerName) {
  const prefs = getPreferences();
  prefs.playerPreferences = prefs.playerPreferences.filter((p) => p.playerName !== playerName);
  savePreferences(prefs);
  return prefs;
}

/** Find a stated preference that matches an available player by name (case-insensitive). */
export function findMatchingPreference(prefs, availablePlayers) {
  for (const pref of prefs.playerPreferences) {
    const match = availablePlayers.find(
      (p) => p.name.toLowerCase() === pref.playerName.toLowerCase()
    );
    if (match) return { pref, player: match };
  }
  return null;
}
