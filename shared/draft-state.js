// The core draft-state engine — provider-agnostic on purpose. It doesn't care whether
// a "pick" came from the placeholder dataset (practice mode) or a live poll of
// Yahoo/ESPN's real draft results (live mode, see live-sync.js) — both flow through
// recordPick() the same way. This is what "recommend my next pick in real time" and
// "practice against mock opponents" both build on.
//
// Persisted via shared/storage.js so a page refresh mid-draft doesn't lose anything
// (explicit architecture decision — see docs/CONTEXT.md).

import { saveJSON, loadJSON } from "./storage.js";

const STATE_KEY = "draft_state";

/**
 * @param {{numTeams: number, myTeamSlot: number, rosterSlots: {slot:string, count:number, eligiblePositions:string[]}[], players: Array}} config
 */
export function initDraftState(config) {
  const state = {
    numTeams: config.numTeams,
    myTeamSlot: config.myTeamSlot, // 1-indexed draft position
    rosterSlots: config.rosterSlots,
    totalRounds: config.rosterSlots.reduce((sum, s) => sum + s.count, 0),
    players: config.players, // full pool, availability derived from `picks`
    picks: [], // { pickNumber, round, teamSlot, providerPlayerId, source: "mock"|"live"|"manual" }
    mode: config.mode || "practice", // "practice" | "live"
  };
  saveJSON(STATE_KEY, state);
  return state;
}

export function getDraftState() {
  return loadJSON(STATE_KEY);
}

export function clearDraftState() {
  saveJSON(STATE_KEY, null);
}

/** Snake draft order: odd rounds go 1..N, even rounds go N..1. */
export function teamSlotForPick(pickNumber, numTeams) {
  const round = Math.floor((pickNumber - 1) / numTeams) + 1;
  const posInRound = (pickNumber - 1) % numTeams; // 0-indexed
  const slot = round % 2 === 1 ? posInRound + 1 : numTeams - posInRound;
  return { round, teamSlot: slot };
}

export function currentPickNumber(state) {
  return state.picks.length + 1;
}

export function isMyPick(state) {
  const { teamSlot } = teamSlotForPick(currentPickNumber(state), state.numTeams);
  return teamSlot === state.myTeamSlot;
}

export function getAvailablePlayers(state) {
  const draftedIds = new Set(state.picks.map((p) => p.providerPlayerId));
  return state.players.filter((p) => !draftedIds.has(p.providerPlayerId));
}

export function getRosterForSlot(state, teamSlot) {
  return state.picks
    .filter((p) => p.teamSlot === teamSlot)
    .map((p) => state.players.find((pl) => pl.providerPlayerId === p.providerPlayerId))
    .filter(Boolean);
}

export function getMyRoster(state) {
  return getRosterForSlot(state, state.myTeamSlot);
}

/**
 * Positional needs, accounting for what's already been drafted vs. what the roster
 * requires. Simple greedy allocation — good enough to drive recommendations; a real
 * lineup optimizer (Phase 2, see docs/CONTEXT.md "Weekly Lineup Engine") is a
 * different, more precise problem.
 */
export function getRosterNeeds(state, teamSlot) {
  const roster = getRosterForSlot(state, teamSlot);
  const counts = {};
  for (const p of roster) counts[p.position] = (counts[p.position] || 0) + 1;

  const needs = [];
  for (const slotDef of state.rosterSlots) {
    if (slotDef.slot === "BN" || slotDef.slot === "IR") continue; // bench/IR aren't "needs"
    const filled = slotDef.eligiblePositions.reduce(
      (sum, pos) => sum + Math.min(counts[pos] || 0, slotDef.count),
      0
    );
    if (filled < slotDef.count) {
      needs.push({ slot: slotDef.slot, remaining: slotDef.count - filled, eligiblePositions: slotDef.eligiblePositions });
    }
  }
  return needs;
}

/**
 * @param {"mock"|"live"|"manual"} source
 */
export function recordPick(state, providerPlayerId, source = "manual") {
  const pickNumber = currentPickNumber(state);
  const { round, teamSlot } = teamSlotForPick(pickNumber, state.numTeams);
  state.picks.push({ pickNumber, round, teamSlot, providerPlayerId, source });
  saveJSON(STATE_KEY, state);
  return state;
}
