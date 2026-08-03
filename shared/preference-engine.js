// The "personal preference layer" — REAL now, not stubbed. This is the founding
// requirement of the whole project (see the very first message in docs/CONTEXT.md's
// project history, and the explicit reconfirmation on 2026-08-03): show the model's
// real #1 pick, show the user's stated preference if one applies, show the honest
// delta between them, let the user decide — and if they override, never punish them
// for it going forward.
//
// Non-negotiable per the user's own words (2026-08-03): "the brain is focused on the
// most points at all times no matter what" — this module NEVER blends bias into the
// model's own recommendation. It only ever presents both, honestly, side by side.

/**
 * @param {{player: object, scoreResult: {score:number, reasoning:string[]}}} modelTopPick
 * @param {{pref: object, player: object}|null} preferenceMatch - from
 *   preferences.findMatchingPreference()
 * @param {Array<{player:object, scoreResult:object}>} rankedAvailable - full ranked
 *   list, needed to look up the preferred player's own score if it isn't the top pick
 * @returns {null|{aligned:boolean, modelPick:object, preferredPick:object|null, confidenceDeltaPct:number|null, message:string}}
 */
export function applyPreferenceLayer(modelTopPick, preferenceMatch, rankedAvailable) {
  if (!preferenceMatch) return null; // nothing stated, or nothing available matches

  const preferredEntry = rankedAvailable.find(
    (r) => r.player.providerPlayerId === preferenceMatch.player.providerPlayerId
  );
  if (!preferredEntry) return null;

  const aligned =
    modelTopPick.player.providerPlayerId === preferenceMatch.player.providerPlayerId;

  if (aligned) {
    return {
      aligned: true,
      modelPick: modelTopPick,
      preferredPick: preferredEntry,
      confidenceDeltaPct: 0,
      message: `Good news — your stated preference for ${preferenceMatch.pref.playerName} already IS the model's #1 pick here. No tradeoff to make.`,
    };
  }

  const modelScore = modelTopPick.scoreResult.score;
  const preferredScore = preferredEntry.scoreResult.score;
  // Positive = the model's pick is ahead; can be negative if your preferred player is
  // actually scoring higher, in which case there's no real tradeoff at all.
  const confidenceDeltaPct =
    modelScore !== 0 ? Math.round(((modelScore - preferredScore) / Math.abs(modelScore)) * 100) : 0;

  const message =
    confidenceDeltaPct <= 0
      ? `Your stated preference, ${preferenceMatch.pref.playerName}, actually scores as well or better than the model's top pick right now (${modelTopPick.player.name}) — no real data tradeoff to accepting your preference here.`
      : `The model's top pick is ${modelTopPick.player.name} (${modelTopPick.scoreResult.score.toFixed(1)} VORP). ` +
        `Your stated preference is ${preferenceMatch.pref.playerName} (${preferredEntry.scoreResult.score.toFixed(1)} VORP) — ` +
        `taking your preference over the model's pick costs roughly ${confidenceDeltaPct}% of this pick's value by our current numbers. ` +
        `Your call — overriding won't change how future picks get evaluated.`;

  return {
    aligned: false,
    modelPick: modelTopPick,
    preferredPick: preferredEntry,
    confidenceDeltaPct,
    message,
  };
}

/**
 * Called after the user overrides (or accepts) a pick. By design there is nothing
 * special to "recalculate" here beyond recording the pick — draft-state.js already
 * derives availability/roster-needs fresh from `picks` on every read, so the very
 * next recommendation is automatically computed from the real post-pick board. That
 * IS the "don't punish the override" guarantee: there's no separate penalty state to
 * carry forward, because none exists. This function exists mainly so the intent is
 * explicit and documented, not implicit.
 */
export function acknowledgeOverride(acceptedPlayerName) {
  return `Locked in ${acceptedPlayerName}. Recommendations from here are computed fresh from the actual remaining board — nothing about this pick reduces future confidence.`;
}
