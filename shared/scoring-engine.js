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

import { computeReplacementLevels, computeVORP } from "./replacement-value.js";
import { computeTiers, remainingInTier } from "./tiering.js";

export const DEFAULT_TIER_WEIGHTS = {
  projections: 0.4,
  efficiency: 0.3,
  contextual: 0.2,
  risk: 0.1,
};

/**
 * Tier 1 — Projections. REAL, not stubbed: VORP + tier-cliff awareness, both unit
 * tested (see engine.selftest.mjs). Still missing from the original spec's Tier 1
 * factors: Vegas-implied team totals and ADP-vs-current-pick delta — both need a live
 * data source we haven't wired in yet (The Odds API needs the user's key; ADP needs a
 * free source, not FantasyPros per docs/ISSUE_LOG.md). Scoped honestly as "VORP +
 * tiering only" until those land.
 *
 * @param {{position: string, projectedPoints: number, providerPlayerId: string}} player
 * @param {Array} allPlayersAtPosition - full pool for that position, for tiering/VORP
 * @param {{numTeams: number, startersPerTeamByPosition: Record<string, number>}} leagueSettings
 * @returns {{score: number, vorp: number, tier: number, remainingInTier: number, reasoning: string[]}}
 */
export function scoreProjectionsTier(player, allPlayersAtPosition, leagueSettings) {
  const replacementLevels = computeReplacementLevels(allPlayersAtPosition, leagueSettings);
  const vorp = computeVORP(player, replacementLevels);
  const tiers = computeTiers(allPlayersAtPosition.filter((p) => p.position === player.position));
  const tierEntry = tiers.find((t) =>
    t.players.some((p) => p.providerPlayerId === player.providerPlayerId)
  );
  const cliffRemaining = remainingInTier(tiers, player.providerPlayerId);

  const reasoning = [
    `${vorp >= 0 ? "+" : ""}${vorp.toFixed(1)} points over replacement at ${player.position}`,
    tierEntry ? `Tier ${tierEntry.tier} at ${player.position}` : "Tier unavailable",
  ];
  if (cliffRemaining !== null && cliffRemaining <= 1) {
    reasoning.push(
      `Only ${cliffRemaining} other player(s) left in this tier — a run here empties it fast.`
    );
  }

  return {
    score: vorp, // raw VORP for now; normalizing across positions comes once efficiency/contextual/risk tiers exist to combine against
    vorp,
    tier: tierEntry?.tier ?? null,
    remainingInTier: cliffRemaining,
    reasoning,
  };
}

/**
 * @param {CanonicalPlayer} player
 * @param {object} context - league settings, current roster needs, available board,
 *   market signals (Kalshi/Polymarket implied probabilities), weather, etc.
 * @param {object} weights - see DEFAULT_TIER_WEIGHTS; user-adjustable via settings.
 * @returns {Promise<{score: number, tierBreakdown: object, reasoning: string[], riskFlags: string[]}>}
 */
export async function scorePlayer(player, context, weights = DEFAULT_TIER_WEIGHTS) {
  // TODO: efficiency/contextual/risk tiers are still stubbed — projections tier
  // (scoreProjectionsTier, above) is real. Once the other three exist, run all four
  // concurrently:
  //   const [projections, efficiency, contextual, risk] = await Promise.all([...])
  // then combine with `weights`, and always return a human-readable `reasoning` array
  // — never just a bare number. See docs/CONTEXT.md for the exact factors per tier.
  throw new Error(
    "scorePlayer() combines all 4 tiers and is not implemented yet — " +
      "scoreProjectionsTier() above IS implemented if you just need that one."
  );
}

/**
 * Given the full available-player board, return the top N recommendations for the
 * pick on the clock. Must respect roster needs (positional scarcity) and tier-cliff
 * risk (is a position's next tier about to disappear).
 */
export async function recommendPicks(board, context, weights = DEFAULT_TIER_WEIGHTS, topN = 3) {
  throw new Error("recommendPicks() is not implemented yet — see shared/scoring-engine.js");
}
