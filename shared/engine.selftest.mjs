// Lightweight sanity check for the pure "brain" math (VORP + tiering) — no test
// framework dependency, just Node's built-in assert. Run with:
//   node shared/engine.selftest.mjs
// Keep this passing as scoring-engine.js grows; extend it alongside new logic rather
// than trusting new math by inspection alone.

import assert from "node:assert/strict";
import { computeReplacementLevels, computeVORP } from "./replacement-value.js";
import { computeTiers, remainingInTier } from "./tiering.js";

// --- Synthetic RB pool: 24 players, clear tiers by construction -----------------
const rbPool = [
  { providerPlayerId: "rb1", position: "RB", projectedPoints: 320 }, // Tier 1
  { providerPlayerId: "rb2", position: "RB", projectedPoints: 310 }, // Tier 1
  { providerPlayerId: "rb3", position: "RB", projectedPoints: 260 }, // big drop -> Tier 2
  { providerPlayerId: "rb4", position: "RB", projectedPoints: 255 },
  { providerPlayerId: "rb5", position: "RB", projectedPoints: 250 },
  { providerPlayerId: "rb6", position: "RB", projectedPoints: 180 }, // big drop -> Tier 3
  { providerPlayerId: "rb7", position: "RB", projectedPoints: 175 },
  { providerPlayerId: "rb8", position: "RB", projectedPoints: 170 },
  { providerPlayerId: "rb9", position: "RB", projectedPoints: 165 },
  { providerPlayerId: "rb10", position: "RB", projectedPoints: 160 },
  { providerPlayerId: "rb11", position: "RB", projectedPoints: 100 }, // replacement zone
  { providerPlayerId: "rb12", position: "RB", projectedPoints: 95 },
];
const wrPool = Array.from({ length: 12 }, (_, i) => ({
  providerPlayerId: `wr${i + 1}`,
  position: "WR",
  projectedPoints: 300 - i * 15,
}));

const allPlayers = [...rbPool, ...wrPool];

// --- computeReplacementLevels --------------------------------------------------
const settings = {
  numTeams: 10,
  startersPerTeamByPosition: { RB: 2.5, WR: 2.5 }, // 2 RB/WR + shared FLEX approx
};
const replacementLevels = computeReplacementLevels(allPlayers, settings);
// 2.5 * 10 = 25 -> rounds to 25, but pool only has 12 RBs, so it should fall back to
// the worst player in the pool (95) rather than crash or return undefined.
assert.equal(replacementLevels.RB, 95, `expected RB replacement level 95, got ${replacementLevels.RB}`);
assert.equal(replacementLevels.WR, 135, `expected WR replacement level 135, got ${replacementLevels.WR}`);

// --- computeVORP ----------------------------------------------------------------
const rb1Vorp = computeVORP(rbPool[0], replacementLevels);
assert.equal(rb1Vorp, 320 - 95, "top RB's VORP should be projectedPoints - replacement");

const belowReplacement = computeVORP({ position: "RB", projectedPoints: 50 }, replacementLevels);
assert.ok(belowReplacement < 0, "a player projected below replacement level should have negative VORP");

// --- computeTiers -----------------------------------------------------------------
const rbTiers = computeTiers(rbPool);
assert.equal(rbTiers.length >= 3, true, `expected at least 3 RB tiers from the constructed gaps, got ${rbTiers.length}`);
assert.equal(rbTiers[0].players.map((p) => p.providerPlayerId).join(","), "rb1,rb2", "Tier 1 should be exactly rb1, rb2");

// --- remainingInTier -------------------------------------------------------------
const remaining = remainingInTier(rbTiers, "rb1");
assert.equal(remaining, 1, "rb1 is first of 2 in Tier 1, so 1 player should remain after it");

console.log("All engine self-tests passed:");
console.log("  replacementLevels:", replacementLevels);
console.log("  rb1 VORP:", rb1Vorp);
console.log(
  "  RB tiers:",
  rbTiers.map((t) => ({ tier: t.tier, players: t.players.map((p) => p.providerPlayerId) }))
);
