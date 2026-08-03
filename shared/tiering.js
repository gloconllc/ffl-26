// Positional tiering — groups players at a position into tiers based on projection
// gaps, so the recommendation engine can flag "tier cliffs" (the ADP Arbitrage Alert
// bar and reasoning bullets both depend on this: "this is the last player in Tier 2
// at WR, the next names drop off a cliff"). Pure function, testable with synthetic
// data now.

/**
 * @param {Array<{providerPlayerId: string, projectedPoints: number}>} playersAtPosition
 *   Should already be filtered to one position.
 * @param {number} gapThresholdRatio - a gap is treated as a new tier boundary when the
 *   point drop from one player to the next exceeds this fraction of the current
 *   tier's average points. 0.08 (8%) is a reasonable starting default; tune once we
 *   have real projection data to sanity-check against — see docs/CONTEXT.md.
 * @returns {Array<{tier: number, players: Array}>}
 */
export function computeTiers(playersAtPosition, gapThresholdRatio = 0.08) {
  const sorted = playersAtPosition
    .slice()
    .sort((a, b) => b.projectedPoints - a.projectedPoints);

  if (sorted.length === 0) return [];

  const tiers = [{ tier: 1, players: [sorted[0]] }];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const currentTier = tiers[tiers.length - 1];
    const tierAvg =
      currentTier.players.reduce((sum, p) => sum + p.projectedPoints, 0) /
      currentTier.players.length;

    const gap = prev.projectedPoints - curr.projectedPoints;
    const isNewTier = tierAvg > 0 && gap / tierAvg > gapThresholdRatio;

    if (isNewTier) {
      tiers.push({ tier: currentTier.tier + 1, players: [curr] });
    } else {
      currentTier.players.push(curr);
    }
  }

  return tiers;
}

/** How many players are left in a player's own tier — the "tier cliff" signal. */
export function remainingInTier(tiers, providerPlayerId) {
  for (const t of tiers) {
    const idx = t.players.findIndex((p) => p.providerPlayerId === providerPlayerId);
    if (idx !== -1) return t.players.length - idx - 1;
  }
  return null;
}
