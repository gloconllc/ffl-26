// The statistical "brain" — Tier 1-4 weighted scoring model. STUBBED: signatures and
// structure are real, the actual math is not implemented yet. Fill in once the
// player-identity crosswalk (see docs/CONTEXT.md, "Cross-source player ID mismatch")
// and at least one real projections source are wired in — scoring garbage-in IDs
// produces confident-looking garbage-out scores, which is worse than an obvious stub.
//
// Design constraints this must satisfy (see docs/CONTEXT.md):
// - Tiers run concurrently, not sequentially (draft-night latency target: a few
//   seconds, not fifteen+).
// - Every score comes back with a reasoning breakdown, not just a number — "AI
//   reasoning visible" was an explicit user decision, not an afterthought.
// - Weights are adjustable (settings sliders), defaults below are the base weights
//   from the original spec.

export const DEFAULT_TIER_WEIGHTS = {
  projections: 0.4,
  efficiency: 0.3,
  contextual: 0.2,
  risk: 0.1,
};

/**
 * @param {CanonicalPlayer} player
 * @param {object} context - league settings, current roster needs, available board,
 *   market signals (Kalshi/Polymarket implied probabilities), weather, etc.
 * @param {object} weights - see DEFAULT_TIER_WEIGHTS; user-adjustable via settings.
 * @returns {Promise<{score: number, tierBreakdown: object, reasoning: string[], riskFlags: string[]}>}
 */
export async function scorePlayer(player, context, weights = DEFAULT_TIER_WEIGHTS) {
  // TODO: implement. Run the four tier scorers concurrently:
  //   const [projections, efficiency, contextual, risk] = await Promise.all([...])
  // then combine with `weights`, and always return a human-readable `reasoning` array
  // — never just a bare number. See docs/CONTEXT.md for the exact factors per tier.
  throw new Error("scorePlayer() is not implemented yet — see shared/scoring-engine.js");
}

/**
 * Given the full available-player board, return the top N recommendations for the
 * pick on the clock. Must respect roster needs (positional scarcity) and tier-cliff
 * risk (is a position's next tier about to disappear).
 */
export async function recommendPicks(board, context, weights = DEFAULT_TIER_WEIGHTS, topN = 3) {
  throw new Error("recommendPicks() is not implemented yet — see shared/scoring-engine.js");
}
