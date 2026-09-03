// Value Over Replacement Player (VORP) — the backbone of the "Projections" tier and,
// eventually, of roster-need-aware recommendations. Pure functions, no I/O, so they're
// testable with synthetic data right now even though we don't have a real projections
// source wired in yet (see docs/CONTEXT.md — nflverse/Sleeper still queued).
//
// Ported/adapted from the pattern in derekrbreese/fantasy-football-mcp-public's
// position_normalizer.py (see docs/CONTEXT.md) — reimplemented here in JS rather than
// copied, since the source data shape differs.

/**
 * Replacement level = the projected points of the last starter-worthy player at a
 * position, i.e. the player who'd be on the wire/bench in a typical league. Standard
 * approach: for a position with `startersPerTeam` starting slots (accounting for
 * FLEX-eligible positions sharing a pool) across `numTeams` teams, the replacement
 * player is ranked at (startersPerTeam * numTeams) within that position's sorted list.
 *
 * @param {Array<{providerPlayerId: string, position: string, projectedPoints: number}>} players
 * @param {{numTeams: number, startersPerTeamByPosition: Record<string, number>}} settings
 *   startersPerTeamByPosition should already account for shared FLEX allocation —
 *   e.g. if a league starts 2 RB + 1 FLEX and FLEX usually goes to a RB/WR roughly
 *   evenly, a reasonable approximation is RB: 2.5, WR: 2.5 rather than RB: 2, WR: 2.
 *   This is an approximation by design; refine once real usage data says otherwise.
 * @returns {Record<string, number>} replacement-level projected points per position
 */
export function computeReplacementLevels(players, settings) {
  const { numTeams, startersPerTeamByPosition } = settings;
  const byPosition = groupByPosition(players);
  const replacementLevels = {};

  for (const [position, starters] of Object.entries(startersPerTeamByPosition)) {
    const pool = (byPosition[position] || [])
      .slice()
      .sort((a, b) => b.projectedPoints - a.projectedPoints);

    const replacementRank = Math.max(1, Math.round(starters * numTeams));
    // Rank is 1-indexed; the replacement player is the first one who WOULDN'T be a
    // starter anywhere, i.e. just past the cutoff.
    const replacementPlayer = pool[replacementRank]; // index = rank (0-indexed array, so rank N -> index N is the (N+1)th player, one past N starters)
    replacementLevels[position] = replacementPlayer
      ? replacementPlayer.projectedPoints
      : pool.length > 0
        ? pool[pool.length - 1].projectedPoints
        : 0;
  }

  return replacementLevels;
}

/**
 * @param {{position: string, projectedPoints: number}} player
 * @param {Record<string, number>} replacementLevels - from computeReplacementLevels()
 * @returns {number} VORP — can be negative for below-replacement players
 */
export function computeVORP(player, replacementLevels) {
  const baseline = replacementLevels[player.position] ?? 0;
  return player.projectedPoints - baseline;
}

function groupByPosition(players) {
  const out = {};
  for (const p of players) {
    if (!out[p.position]) out[p.position] = [];
    out[p.position].push(p);
  }
  return out;
}
