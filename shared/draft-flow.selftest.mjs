// End-to-end sanity check for draft-state.js + mock-draft.js + scoring-engine.js
// working together against the real placeholder dataset — not just the isolated
// VORP/tiering math (see engine.selftest.mjs for that). Run with:
//   node shared/draft-flow.selftest.mjs
//
// These modules assume a browser's localStorage; polyfill a minimal in-memory one so
// this can run under plain Node.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const memoryStore = new Map();
globalThis.localStorage = {
  getItem: (k) => (memoryStore.has(k) ? memoryStore.get(k) : null),
  setItem: (k, v) => memoryStore.set(k, v),
  removeItem: (k) => memoryStore.delete(k),
};

const { initDraftState, getDraftState, isMyPick, currentPickNumber, teamSlotForPick, getAvailablePlayers, getMyRoster, getRosterNeeds } =
  await import("./draft-state.js");
const { simulateUntilMyTurn, pickForOpponent } = await import("./mock-draft.js");
const { scoreProjectionsTier } = await import("./scoring-engine.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(
  readFileSync(join(__dirname, "data", "placeholder-players.json"), "utf-8")
);
const players = dataset.players;
assert.ok(players.length > 100, `expected a decently sized placeholder pool, got ${players.length}`);

const rosterSlots = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 2, eligiblePositions: ["RB"] },
  { slot: "WR", count: 2, eligiblePositions: ["WR"] },
  { slot: "TE", count: 1, eligiblePositions: ["TE"] },
  { slot: "FLEX", count: 1, eligiblePositions: ["RB", "WR", "TE"] },
  { slot: "K", count: 1, eligiblePositions: ["K"] },
  { slot: "DEF", count: 1, eligiblePositions: ["DEF"] },
  { slot: "BN", count: 6, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];

let state = initDraftState({
  numTeams: 10,
  myTeamSlot: 5,
  mode: "practice",
  rosterSlots,
  players,
});

// --- snake order sanity ---------------------------------------------------------
assert.deepEqual(teamSlotForPick(1, 10), { round: 1, teamSlot: 1 });
assert.deepEqual(teamSlotForPick(10, 10), { round: 1, teamSlot: 10 });
assert.deepEqual(teamSlotForPick(11, 10), { round: 2, teamSlot: 10 }); // snake reverses
assert.deepEqual(teamSlotForPick(20, 10), { round: 2, teamSlot: 1 });
assert.equal(isMyPick(state), false, "pick 1 belongs to team 1, not my team (slot 5)");

// --- simulate a full 8-round draft, always taking the top recommendation --------
let roundsCompleted = 0;
for (let round = 0; round < 8; round++) {
  state = getDraftState();
  simulateUntilMyTurn(state, isMyPick);
  state = getDraftState();

  if (currentPickNumber(state) > state.numTeams * 8) break; // draft over

  assert.equal(isMyPick(state), true, `expected it to be my turn at pick ${currentPickNumber(state)}`);

  const available = getAvailablePlayers(state);
  const ranked = available
    .map((p) => ({ player: p, result: scoreProjectionsTier(p, available, { numTeams: 10, startersPerTeamByPosition: { QB: 1, RB: 2.5, WR: 2.5, TE: 1, K: 1, DEF: 1 } }) }))
    .sort((a, b) => b.result.score - a.result.score);

  const topPick = ranked[0].player;
  const { recordPick } = await import("./draft-state.js");
  recordPick(state, topPick.providerPlayerId, "manual");
  roundsCompleted++;
}

assert.equal(roundsCompleted, 8, "expected to complete 8 simulated rounds for my team");

// --- no duplicate picks -----------------------------------------------------------
state = getDraftState();
const draftedIds = state.picks.map((p) => p.providerPlayerId);
const uniqueIds = new Set(draftedIds);
assert.equal(draftedIds.length, uniqueIds.size, "no player should be drafted twice");

// --- my roster has exactly 8 players, no position over-drafted vs pool -----------
const myRoster = getMyRoster(state);
assert.equal(myRoster.length, 8, `expected 8 players on my roster after 8 rounds, got ${myRoster.length}`);

const needs = getRosterNeeds(state, state.myTeamSlot);
console.log("All draft-flow self-tests passed:");
console.log(`  Total picks made: ${state.picks.length}`);
console.log(`  My roster (${myRoster.length}):`, myRoster.map((p) => `${p.name} (${p.position})`));
console.log(`  Remaining starting needs:`, needs);
