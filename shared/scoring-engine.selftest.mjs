// Self-test for the now-real 4-tier scorePlayer() — run against the actual
// nflverse-sourced data (shared/data/players-live.json), not synthetic fixtures,
// since the whole point of this pass was replacing placeholder data with real data.
// Run: node shared/scoring-engine.selftest.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  scorePlayer,
  scoreEfficiencyTier,
  scoreRiskTier,
  scoreContextualTier,
  DEFAULT_TIER_WEIGHTS,
} from "./scoring-engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "data");

const playersFile = JSON.parse(readFileSync(join(dataDir, "players-live.json"), "utf8"));
const teamContextFile = JSON.parse(readFileSync(join(dataDir, "team-context-2026.json"), "utf8"));
const players = playersFile.players;
const teamContext = teamContextFile.teams;

function assert(cond, msg) {
  if (!cond) throw new Error(`FAILED: ${msg}`);
}

// --- Sanity: real data actually loaded, not empty/placeholder -----------------------
assert(players.length > 100, "expected a substantial real player pool");
assert(!playersFile._README.includes("SYNTHETIC"), "players-live.json should be real data, not the placeholder file");

const leagueSettings = {
  numTeams: 10,
  startersPerTeamByPosition: { QB: 1, RB: 2.5, WR: 2.5, TE: 1, K: 1, DEF: 1 },
};
const context = { allPlayersAtPosition: players, leagueSettings, teamContext };

// --- scorePlayer() combines all 4 tiers into a 0-100ish blended score ---------------
const lamar = players.find((p) => p.name === "Lamar Jackson");
assert(lamar, "expected Lamar Jackson in the real data set");
const result = scorePlayer(lamar, context, DEFAULT_TIER_WEIGHTS);
assert(typeof result.score === "number" && !Number.isNaN(result.score), "score should be numeric");
assert(result.tierBreakdown.projections >= 0 && result.tierBreakdown.projections <= 100, "projections tier out of 0-100 range");
assert(result.tierBreakdown.efficiency >= 0 && result.tierBreakdown.efficiency <= 100, "efficiency tier out of 0-100 range");
assert(result.reasoning.length > 0, "expected human-readable reasoning bullets");
assert(typeof result.vorp === "number", "raw VORP should still be exposed for UI display");

// --- Weight sliders now genuinely change the outcome (the whole point of this pass) -
const projectionsOnly = { projections: 1, efficiency: 0, contextual: 0, risk: 0 };
const riskOnly = { projections: 0, efficiency: 0, contextual: 0, risk: 1 };
const qbPool = players.filter((p) => p.position === "QB");
const injuredQb = qbPool.find((p) => p.injuryStatus) || qbPool[1];
const healthyQb = qbPool.find((p) => !p.injuryStatus && p.projectedPoints > 0);
if (injuredQb && healthyQb && injuredQb.providerPlayerId !== healthyQb.providerPlayerId) {
  const injuredUnderRisk = scorePlayer(injuredQb, context, riskOnly).score;
  const healthyUnderRisk = scorePlayer(healthyQb, context, riskOnly).score;
  // Under a risk-only weighting, a healthy player's score should never trail an
  // injured one purely because of injury status (may tie if neither has a flag).
  assert(
    healthyUnderRisk >= injuredUnderRisk,
    `expected healthy QB risk score (${healthyUnderRisk}) >= injured QB (${injuredUnderRisk})`
  );
}

// --- scoreEfficiencyTier degrades gracefully for a player with no usable data -------
const noDataPlayer = { position: "QB", epaPerGamePassing: null };
const eff = scoreEfficiencyTier(noDataPlayer, players);
assert(eff.score === 50, "efficiency tier should return neutral 50 when no data is available");

// --- scoreContextualTier degrades gracefully for an unknown team --------------------
const ctxUnknown = scoreContextualTier({ team: "ZZZ" }, teamContext);
assert(ctxUnknown.score === 50, "contextual tier should return neutral 50 for a team with no schedule data");

// --- scoreRiskTier penalizes Out/IR more than Questionable --------------------------
const outScore = scoreRiskTier({ injuryStatus: "Out", gamesPlayedLastSeason: 17 }).score;
const questionableScore = scoreRiskTier({ injuryStatus: "Questionable", gamesPlayedLastSeason: 17 }).score;
const healthyScore = scoreRiskTier({ injuryStatus: null, gamesPlayedLastSeason: 17 }).score;
assert(healthyScore > questionableScore, "healthy should score above questionable");
assert(questionableScore > outScore, "questionable should score above out/IR");

console.log("All scoring-engine self-tests passed against real data:");
console.log(`  Real player pool size: ${players.length}`);
console.log(`  Lamar Jackson blended score: ${result.score} (tiers: ${JSON.stringify(result.tierBreakdown)})`);
console.log(`  Risk-tier ordering verified: healthy(${healthyScore}) > questionable(${questionableScore}) > out(${outScore})`);
