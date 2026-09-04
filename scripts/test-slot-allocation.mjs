// Plain Node unit test (no browser needed) for computeSlotAllocation()/getRosterNeeds()
// in shared/draft-state.js — specifically the FLEX/roster-needs double-counting bug
// found by the 2026-09-04 full-app review and fixed this pass. Run with:
//   node scripts/test-slot-allocation.mjs

import { computeSlotAllocation, getRosterNeeds } from "../shared/draft-state.js";

let failures = 0;
function assert(cond, label) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

const ROSTER_SLOTS = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 2, eligiblePositions: ["RB"] },
  { slot: "WR", count: 2, eligiblePositions: ["WR"] },
  { slot: "TE", count: 1, eligiblePositions: ["TE"] },
  { slot: "FLEX", count: 1, eligiblePositions: ["RB", "WR", "TE"] },
  { slot: "K", count: 1, eligiblePositions: ["K"] },
  { slot: "DEF", count: 1, eligiblePositions: ["DEF"] },
  { slot: "BN", count: 6, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];

function mkPlayer(id, position) {
  return { providerPlayerId: id, position, name: `Player ${id}` };
}

// --- The exact bug scenario: QB x1, RB x2 — old code reported RB and FLEX as BOTH
// filled (double-counting each RB toward both the RB slot and FLEX simultaneously),
// hiding a genuine FLEX need. -------------------------------------------------------
{
  const roster = [mkPlayer(1, "QB"), mkPlayer(2, "RB"), mkPlayer(3, "RB")];
  const allocation = computeSlotAllocation(roster, ROSTER_SLOTS);
  const rb = allocation.find((a) => a.slot === "RB");
  const flex = allocation.find((a) => a.slot === "FLEX");
  assert(rb.filled === 2 && rb.remaining === 0, "2 RBs fully fill the dedicated RB slot");
  assert(flex.filled === 0 && flex.remaining === 1, "FLEX still shows as needing a player with only 2 RBs rostered (the actual bug)");

  const needs = getRosterNeeds({ rosterSlots: ROSTER_SLOTS, picks: [], players: [], myTeamSlot: 1 }, 1);
  // getRosterNeeds reads off state.picks via getRosterForSlot, not the raw roster —
  // exercise it through the real shape too.
  const state = {
    rosterSlots: ROSTER_SLOTS,
    myTeamSlot: 1,
    players: roster,
    picks: roster.map((p, i) => ({ pickNumber: i + 1, round: 1, teamSlot: 1, providerPlayerId: p.providerPlayerId })),
  };
  const realNeeds = getRosterNeeds(state, 1);
  const flexNeed = realNeeds.find((n) => n.slot === "FLEX");
  assert(Boolean(flexNeed), "getRosterNeeds() surfaces FLEX as an open need with 2 RBs rostered (regression guard)");
  const rbNeed = realNeeds.find((n) => n.slot === "RB");
  assert(!rbNeed, "getRosterNeeds() does NOT list RB itself as a need once 2 RBs are rostered");
}

// --- A 3rd RB should fill FLEX and correctly clear the need. ------------------------
{
  const roster = [mkPlayer(1, "QB"), mkPlayer(2, "RB"), mkPlayer(3, "RB"), mkPlayer(4, "RB")];
  const allocation = computeSlotAllocation(roster, ROSTER_SLOTS);
  const rb = allocation.find((a) => a.slot === "RB");
  const flex = allocation.find((a) => a.slot === "FLEX");
  assert(rb.filled === 2, "RB slot stays capped at 2 even with a 3rd RB rostered");
  assert(flex.filled === 1 && flex.remaining === 0, "3rd RB correctly fills FLEX");
}

// --- A player is never double-counted across two slots at once. --------------------
{
  const roster = [mkPlayer(1, "TE"), mkPlayer(2, "TE")];
  const allocation = computeSlotAllocation(roster, ROSTER_SLOTS);
  const te = allocation.find((a) => a.slot === "TE");
  const flex = allocation.find((a) => a.slot === "FLEX");
  const totalCredited = te.players.length + flex.players.length;
  assert(totalCredited === 2, "2 TEs are credited exactly once each across TE+FLEX combined, never double-counted");
  assert(te.filled === 1 && flex.filled === 1, "1st TE fills the dedicated TE slot, 2nd TE fills FLEX");
}

// --- BN (least specific — eligible for everything) always resolves last, absorbing
// only genuine leftovers rather than starving a more specific slot. -----------------
{
  const roster = [mkPlayer(1, "QB"), mkPlayer(2, "QB")]; // 2nd QB has nowhere but BN to go
  const allocation = computeSlotAllocation(roster, ROSTER_SLOTS);
  const qb = allocation.find((a) => a.slot === "QB");
  const bn = allocation.find((a) => a.slot === "BN");
  assert(qb.filled === 1, "Only 1 QB credited to the dedicated QB slot even with 2 QBs rostered");
  assert(bn.filled === 1 && bn.players[0].providerPlayerId === 2, "2nd QB correctly falls through to BN, not lost or double-counted");
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll slot-allocation tests passed.");
process.exit(failures ? 1 : 0);
