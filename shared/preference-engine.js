// The "personal preference layer" — see docs/CONTEXT.md for the exact flow the user
// specified. STUBBED: real structure, math not implemented yet (depends on
// scoring-engine.js being real first).
//
// Flow (non-negotiable, from the original spec):
// 1. Show the model's #1 recommendation with full confidence breakdown.
// 2. Show the user's stated preference for/against this player, if any.
// 3. Compute a "personal adjusted score" that weighs the preference against the model.
// 4. Ask the user to confirm or override — always show the confidence delta.
// 5. If overridden: recompute the remaining board WITHOUT punishing the user — find
//    the next-optimal picks given the accepted choice. Never make the user feel like
//    the model is sulking about their decision.
// 6. If accepted: draft normally, refresh the board.

/**
 * @param {object} modelTopPick - result of scoring-engine.recommendPicks()[0]
 * @param {object|null} statedPreference - { playerId, direction: "for"|"against", strength: 0-1 }
 * @returns {{ recommendedPlayer: object, confidence: number, overridePrompt: string|null }}
 */
export function applyPreferenceLayer(modelTopPick, statedPreference) {
  throw new Error("applyPreferenceLayer() is not implemented yet — see shared/preference-engine.js");
}

/**
 * Called after the user overrides the model's pick. Must NOT simply re-run the same
 * scoring with the overridden player removed — it should acknowledge the accepted
 * choice and re-optimize everything downstream (roster needs shift, tier cliffs move,
 * etc.) so the user still gets the best available path forward.
 */
export function recalculateAfterOverride(board, context, acceptedPlayer) {
  throw new Error("recalculateAfterOverride() is not implemented yet — see shared/preference-engine.js");
}
