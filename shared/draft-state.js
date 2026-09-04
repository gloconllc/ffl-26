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
  // Throw rather than silently continue on a failed save — this app's whole draft-day
  // pitch is "a page refresh never loses a pick" (see storage.js's saveJSON doc
  // comment), so starting a draft that can't actually persist needs to surface loudly
  // (via the existing safe()/error-banner wrapper at every call site in app.js)
  // instead of leaving the user to discover it only after a refresh wipes everything.
  if (!saveJSON(STATE_KEY, state)) {
    throw new Error("Couldn't save draft state to local storage — it won't survive a page refresh. Check your browser's storage settings (private browsing and full storage quotas are the usual cause) and try again.");
  }
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
 * Assigns each rostered player to AT MOST ONE roster slot, filling more specific
 * slots (fewer eligible positions — QB, RB, WR, TE, K, DEF) before generic ones
 * (FLEX, then BN last). This is the one place slot-fill counting happens; both
 * getRosterNeeds() below and the Roster/Lineup tabs (draft-app/app.js) go through it.
 *
 * Fixes a real bug from the previous approach (counting each position's total
 * against every slot independently): with 2 rostered RBs and a roster shape of
 * RB×2 + FLEX×1 (RB/WR/TE-eligible), the old code credited both RBs toward the
 * dedicated RB slot AND toward FLEX at the same time, so FLEX read as "filled" the
 * moment you had 2 RBs or 2 WRs — even though a genuine 3rd RB/WR/TE body is still
 * needed. That silently broke the "Recommended" (needs-aware) strategy's ability to
 * ever boost a FLEX-only need. Sorting by specificity and consuming players from a
 * shared not-yet-used pool (instead of counting from the full roster every time)
 * fixes this for good, for every roster shape (BN's "any position" eligibility is
 * least specific, so it always resolves last, correctly getting only leftovers).
 *
 * @param {Array} roster - players already on this team (see getRosterForSlot/getMyRoster)
 * @param {{slot:string, count:number, eligiblePositions:string[]}[]} rosterSlots
 * @returns {{slot:string, count:number, filled:number, remaining:number, eligiblePositions:string[], players:Array}[]}
 *   in the same order as `rosterSlots`.
 */
export function computeSlotAllocation(roster, rosterSlots) {
  const pool = roster.map((player, i) => ({ player, id: player.providerPlayerId ?? i, used: false }));
  const ordered = rosterSlots
    .map((slotDef, i) => ({ slotDef, i }))
    .sort((a, b) => a.slotDef.eligiblePositions.length - b.slotDef.eligiblePositions.length || a.i - b.i);

  const filledBySlot = new Map();
  for (const { slotDef } of ordered) {
    const matches = pool.filter((rp) => !rp.used && slotDef.eligiblePositions.includes(rp.player.position));
    const taken = matches.slice(0, slotDef.count);
    taken.forEach((rp) => (rp.used = true));
    filledBySlot.set(slotDef.slot, taken.map((rp) => rp.player));
  }

  return rosterSlots.map((slotDef) => {
    const players = filledBySlot.get(slotDef.slot) || [];
    return {
      slot: slotDef.slot,
      count: slotDef.count,
      filled: players.length,
      remaining: Math.max(0, slotDef.count - players.length),
      eligiblePositions: slotDef.eligiblePositions,
      players,
    };
  });
}

/**
 * Positional needs, accounting for what's already been drafted vs. what the roster
 * requires — see computeSlotAllocation() above for the actual allocation logic.
 */
export function getRosterNeeds(state, teamSlot) {
  const roster = getRosterForSlot(state, teamSlot);
  return computeSlotAllocation(roster, state.rosterSlots)
    .filter((a) => a.slot !== "BN" && a.slot !== "IR" && a.remaining > 0)
    .map((a) => ({ slot: a.slot, remaining: a.remaining, eligiblePositions: a.eligiblePositions }));
}

/**
 * @param {"mock"|"live"|"manual"} source
 */
export function recordPick(state, providerPlayerId, source = "manual") {
  const pickNumber = currentPickNumber(state);
  const { round, teamSlot } = teamSlotForPick(pickNumber, state.numTeams);
  const pick = { pickNumber, round, teamSlot, providerPlayerId, source };
  state.picks.push(pick);
  // See initDraftState()'s comment above — a failed save here means this exact pick
  // (very possibly YOUR live pick, mid-draft) is only in memory and will vanish on
  // the next refresh. Roll back the in-memory push and throw so the caller's
  // safe()/error-banner wrapper tells the user immediately, instead of the pick
  // silently surviving only until the tab closes.
  if (!saveJSON(STATE_KEY, state)) {
    state.picks.pop();
    throw new Error(
      `Couldn't save this pick (pick #${pickNumber}) to local storage — it has NOT been recorded. Check your browser's storage settings and try again immediately.`
    );
  }
  return state;
}
