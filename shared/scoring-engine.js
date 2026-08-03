// The statistical "brain" — Tier 1-4 weighted scoring model. Projections, Efficiency,
// and Risk are now REAL, backed by real nflverse data (see
// scripts/build-player-data.mjs and shared/data/players-live.json) — Contextual is a
// first real pass using Week 1 2026 schedule/odds context only (see
// shared/data/team-context-2026.json), not yet the full weather/coaching/matchup
// picture described in docs/CONTEXT.md.
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

/** Percentile rank (0-100) of `value` within `pool` — higher value = higher percentile. */
function percentileRank(value, pool) {
  if (!pool.length) return 50;
  const below = pool.filter((v) => v < value).length;
  const equal = pool.filter((v) => v === value).length;
  // Standard "mean rank" percentile — ties share the average of the ranks they'd span.
  return Math.round(((below + equal / 2) / pool.length) * 100);
}

/**
 * Tier 2 — Efficiency. REAL, backed by real per-player 2024-season nflverse data
 * (EPA/play, target volume, yards-per-touch) — see shared/data/players-live.json's
 * own README for exact provenance and the "last completed season, not live" caveat.
 * Position-relative: a QB's EPA isn't compared to a WR's, everything is percentiled
 * within the same position pool so the 0-100 scale means the same thing everywhere.
 *
 * @param {object} player - a CanonicalPlayer-shaped object with the epaPerGame /
 *   target/reception/rushing fields produced by scripts/build-player-data.mjs
 * @param {Array} allPlayersAtPosition
 * @returns {{score:number, reasoning:string[]}} score is 0-100, position-relative
 */
export function scoreEfficiencyTier(player, allPlayersAtPosition) {
  const pool = allPlayersAtPosition.filter((p) => p.position === player.position);
  const reasoning = [];
  const metrics = [];

  if (player.position === "QB") {
    const epaPool = pool.map((p) => p.epaPerGamePassing ?? null).filter((v) => v !== null);
    if (player.epaPerGamePassing != null && epaPool.length) {
      const pct = percentileRank(player.epaPerGamePassing, epaPool);
      metrics.push(pct);
      reasoning.push(
        `Passing EPA/game ${player.epaPerGamePassing.toFixed(2)} — ${pct}th percentile at QB (last completed season)`
      );
    }
  } else if (player.position === "RB") {
    const ypcPool = pool.map((p) =>
      p.carriesLastSeason > 0 ? p.rushingYardsLastSeason / p.carriesLastSeason : null
    );
    const validYpc = ypcPool.filter((v) => v !== null);
    const myYpc =
      player.carriesLastSeason > 0 ? player.rushingYardsLastSeason / player.carriesLastSeason : null;
    if (myYpc !== null && validYpc.length) {
      const pct = percentileRank(myYpc, validYpc);
      metrics.push(pct);
      reasoning.push(`${myYpc.toFixed(1)} yds/carry — ${pct}th percentile at RB (last completed season)`);
    }
    const targetPool = pool.map((p) => p.targetShareRaw ?? 0);
    if (player.targetShareRaw != null && targetPool.length) {
      const pct = percentileRank(player.targetShareRaw, targetPool);
      metrics.push(pct);
      reasoning.push(`${player.targetShareRaw} targets last season — ${pct}th percentile receiving volume at RB`);
    }
  } else if (player.position === "WR" || player.position === "TE") {
    const targetPool = pool.map((p) => p.targetShareRaw ?? 0);
    if (player.targetShareRaw != null && targetPool.length) {
      const pct = percentileRank(player.targetShareRaw, targetPool);
      metrics.push(pct);
      reasoning.push(`${player.targetShareRaw} targets last season — ${pct}th percentile volume at ${player.position}`);
    }
    const yptPool = pool.map((p) =>
      p.targetShareRaw > 0 ? p.receivingYardsLastSeason / p.targetShareRaw : null
    );
    const validYpt = yptPool.filter((v) => v !== null);
    const myYpt =
      player.targetShareRaw > 0 ? player.receivingYardsLastSeason / player.targetShareRaw : null;
    if (myYpt !== null && validYpt.length) {
      const pct = percentileRank(myYpt, validYpt);
      metrics.push(pct);
      reasoning.push(`${myYpt.toFixed(1)} yds/target — ${pct}th percentile efficiency at ${player.position}`);
    }
  }

  if (!metrics.length) {
    reasoning.push("No efficiency data available for this player yet — treated as league-average (50th percentile).");
    return { score: 50, reasoning };
  }

  const score = Math.round(metrics.reduce((a, b) => a + b, 0) / metrics.length);
  return { score, reasoning };
}

/**
 * Tier 4 — Risk. REAL: uses the most recent official injury designation on file
 * (from shared/data/players-live.json, sourced via nflverse's injury reports) plus
 * games-played-last-season as a durability signal. 100 = no known risk, 0 = highest.
 *
 * @param {object} player
 * @returns {{score:number, reasoning:string[]}}
 */
export function scoreRiskTier(player) {
  let score = 100;
  const reasoning = [];

  const status = (player.injuryStatus || "").toLowerCase();
  if (status.includes("out") || status.includes("ir") || status.includes("pup")) {
    score -= 60;
    reasoning.push(`Last known injury designation: ${player.injuryStatus} — significant risk flag.`);
  } else if (status.includes("doubtful")) {
    score -= 40;
    reasoning.push(`Last known injury designation: ${player.injuryStatus}.`);
  } else if (status.includes("questionable")) {
    score -= 15;
    reasoning.push(`Last known injury designation: ${player.injuryStatus} (minor flag, most Questionable players play).`);
  } else {
    reasoning.push("No recent injury designation on file.");
  }

  const games = player.gamesPlayedLastSeason;
  if (typeof games === "number") {
    if (games <= 8) {
      score -= 20;
      reasoning.push(`Played only ${games} games last season — durability concern.`);
    } else if (games >= 16) {
      reasoning.push(`Played ${games} games last season — full-season durability.`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  return { score, reasoning };
}

/**
 * Tier 3 — Contextual. First real pass: Week 1 2026 schedule/odds context only
 * (shared/data/team-context-2026.json) — favorable game script (team favored, high
 * implied total) nudges the score up. Does NOT yet cover weather, opposing coordinator
 * tendencies, or full-season strength of schedule — those remain queued per
 * docs/CONTEXT.md. 50 = neutral/no data.
 *
 * @param {object} player
 * @param {Record<string, object>|null} teamContext - shared/data/team-context-2026.json's `teams` map
 * @returns {{score:number, reasoning:string[]}}
 */
export function scoreContextualTier(player, teamContext) {
  const ctx = teamContext?.[player.team];
  if (!ctx) {
    return { score: 50, reasoning: ["No Week 1 schedule/odds context available for this team yet."] };
  }

  let score = 50;
  const reasoning = [];

  if (ctx.week1FavoredToWin) {
    score += 10;
    reasoning.push(`${player.team} is favored in its Week 1 matchup vs. ${ctx.week1Opponent}.`);
  } else {
    reasoning.push(`${player.team} is an underdog in its Week 1 matchup vs. ${ctx.week1Opponent}.`);
  }

  if (ctx.week1TotalLine && ctx.week1TotalLine >= 47) {
    score += 10;
    reasoning.push(`High implied game total (${ctx.week1TotalLine}) — shootout upside for skill positions.`);
  } else if (ctx.week1TotalLine && ctx.week1TotalLine <= 41) {
    score -= 5;
    reasoning.push(`Low implied game total (${ctx.week1TotalLine}) — more conservative game script expected.`);
  }

  if (ctx.headCoach) {
    reasoning.push(`Head coach: ${ctx.headCoach}.`);
  }

  score = Math.max(0, Math.min(100, score));
  return { score, reasoning };
}

/**
 * Combines all four tiers into one weighted, position-relative 0-100 score. This is
 * what finally makes the Settings tier-weight sliders do something real — Projections
 * is percentiled by VORP within position so it's on the same 0-100 scale as the other
 * three, rather than raw VORP dominating the sum by magnitude alone.
 *
 * @param {object} player
 * @param {object} context - { allPlayersAtPosition, leagueSettings, teamContext }
 * @param {object} weights - see DEFAULT_TIER_WEIGHTS; user-adjustable via settings.
 * @returns {{score:number, tierBreakdown:object, reasoning:string[], riskFlags:string[], vorp:number, tier:number|null, remainingInTier:number|null}}
 */
export function scorePlayer(player, context, weights = DEFAULT_TIER_WEIGHTS) {
  const { allPlayersAtPosition, leagueSettings, teamContext } = context;

  const projections = scoreProjectionsTier(player, allPlayersAtPosition, leagueSettings);
  // Percentile the raw VORP (not just projectedPoints) within position so ties near
  // replacement level don't get inflated.
  const vorpPoolForPercentile = allPlayersAtPosition
    .filter((p) => p.position === player.position)
    .map((p) => computeVORP(p, computeReplacementLevels(allPlayersAtPosition, leagueSettings)));
  const projectionsScore = percentileRank(projections.vorp, vorpPoolForPercentile);

  const efficiency = scoreEfficiencyTier(player, allPlayersAtPosition);
  const risk = scoreRiskTier(player);
  const contextual = scoreContextualTier(player, teamContext);

  const tierBreakdown = {
    projections: projectionsScore,
    efficiency: efficiency.score,
    contextual: contextual.score,
    risk: risk.score,
  };

  const score =
    tierBreakdown.projections * weights.projections +
    tierBreakdown.efficiency * weights.efficiency +
    tierBreakdown.contextual * weights.contextual +
    tierBreakdown.risk * weights.risk;

  const riskFlags = [];
  if (risk.score < 60) riskFlags.push(...risk.reasoning);

  // projections.reasoning already includes the tier-cliff warning bullet (added by
  // scoreProjectionsTier itself when remainingInTier <= 1) — no need to duplicate it.
  const reasoning = [
    ...projections.reasoning,
    ...efficiency.reasoning,
    ...contextual.reasoning,
    ...risk.reasoning,
  ];

  return {
    score: Math.round(score * 10) / 10,
    tierBreakdown,
    reasoning,
    riskFlags,
    vorp: projections.vorp,
    tier: projections.tier,
    remainingInTier: projections.remainingInTier,
  };
}

/**
 * Given the full available-player board, return the top N recommendations for the
 * pick on the clock. Respects roster needs by relying on the caller to pass an
 * already-filtered/boosted board when need-awareness matters (see
 * draft-app/app.js's sortByStrategy) — this function's job is purely the scoring,
 * not the strategy-preset blending, which is UI-layer logic.
 */
export function recommendPicks(board, context, weights = DEFAULT_TIER_WEIGHTS, topN = 3) {
  const scored = board.map((player) => ({
    player,
    scoreResult: scorePlayer(player, { ...context, allPlayersAtPosition: board }, weights),
  }));
  scored.sort((a, b) => b.scoreResult.score - a.scoreResult.score);
  return scored.slice(0, topN);
}
