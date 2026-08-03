// Practice-mode opponent AI. Deliberately simple: best-available VORP, with a light
// bias toward filling starting needs before piling up bench depth at one position.
// This is NOT the same engine that will power the user's own recommendations
// (shared/scoring-engine.js is real for that) — opponents just need to be plausible,
// not optimal, so practice mode feels realistic without pretending to model 9+ other
// managers' real preferences.

import { computeReplacementLevels, computeVORP } from "./replacement-value.js";
import {
  getAvailablePlayers,
  getRosterNeeds,
  recordPick,
  currentPickNumber,
  teamSlotForPick,
} from "./draft-state.js";

const DEFAULT_STARTER_BASELINE = {
  QB: 1,
  RB: 2.5,
  WR: 2.5,
  TE: 1,
  K: 1,
  DEF: 1,
};

export function pickForOpponent(state, teamSlot) {
  const available = getAvailablePlayers(state);
  const replacementLevels = computeReplacementLevels(available, {
    numTeams: state.numTeams,
    startersPerTeamByPosition: DEFAULT_STARTER_BASELINE,
  });
  const needs = getRosterNeeds(state, teamSlot);
  const neededPositions = new Set(needs.flatMap((n) => n.eligiblePositions));

  const scored = available.map((p) => ({
    player: p,
    vorp: computeVORP(p, replacementLevels),
    fillsNeed: neededPositions.has(p.position),
  }));

  // Prefer filling an open starting need; within that, take the best VORP.
  scored.sort((a, b) => {
    if (a.fillsNeed !== b.fillsNeed) return a.fillsNeed ? -1 : 1;
    return b.vorp - a.vorp;
  });

  return scored[0]?.player ?? null;
}

/** Advances the draft until it's the user's turn again (or the draft ends). */
export function simulateUntilMyTurn(state, isMyPickFn) {
  let guard = 0;
  while (!isMyPickFn(state) && state.picks.length < state.totalRounds * state.numTeams) {
    const { teamSlot } = teamSlotForPick(currentPickNumber(state), state.numTeams);
    const pick = pickForOpponent(state, teamSlot);
    if (!pick) break; // no players left
    recordPick(state, pick.providerPlayerId, "mock");
    guard++;
    if (guard > 500) break; // safety valve against an infinite loop from a logic bug
  }
  return state;
}
