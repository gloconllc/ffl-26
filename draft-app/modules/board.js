// The Draft Room: the on-the-clock bar, the snake draft board grid (the thing that
// makes this read like a real draft room rather than a spreadsheet), the recent-picks
// table, and the roster-needs rail.
import {
  getDraftState,
  currentPickNumber,
  teamSlotForPick,
  isMyPick,
  computeSlotAllocation,
  getMyRoster,
} from "../../shared/draft-state.js";
import { DEFAULT_ROSTER_SLOTS } from "../../shared/data-sources.js";
import { escapeHtml } from "./dom-utils.js";

/** Pick number for a given round + team slot under snake order. Round 1 runs
 * 1..numTeams left to right; round 2 runs numTeams..1 right to left; and so on. This
 * is the inverse of teamSlotForPick() and has to agree with it exactly, or the board
 * would draw picks in cells that don't match where they were actually recorded. */
function pickNumberFor(round, teamSlot, numTeams) {
  const indexInRound = round % 2 === 1 ? teamSlot : numTeams - teamSlot + 1;
  return (round - 1) * numTeams + indexInRound;
}

function renderClock(state) {
  const bar = document.getElementById("clock-bar");
  const clockEl = document.getElementById("on-the-clock");
  if (!clockEl) return;

  const pickNum = currentPickNumber(state);
  const { round, teamSlot } = teamSlotForPick(pickNum, state.numTeams);
  const mine = isMyPick(state);

  clockEl.textContent = mine
    ? `You — pick ${pickNum} · round ${round}`
    : `Team ${teamSlot} — pick ${pickNum} · round ${round}`;
  if (bar) bar.classList.toggle("is-mine", mine);
}

/** The board itself: teams across the top, rounds down the side, every pick in its
 * true snake position so you can see the shape of the draft — runs on positions, where
 * the value went, and exactly how far away your next turn is. */
function renderGrid(state) {
  const grid = document.getElementById("draft-board-grid");
  if (!grid) return;

  const { numTeams, myTeamSlot } = state;
  // Draw enough rounds to cover the roster, so the board shows the whole draft rather
  // than only what's been picked so far.
  const totalRounds = Math.max(
    1,
    DEFAULT_ROSTER_SLOTS.reduce((sum, s) => sum + s.count, 0)
  );
  const currentPick = currentPickNumber(state);

  const pickByNumber = new Map();
  for (const pick of state.picks) pickByNumber.set(pick.pickNumber, pick);
  const playerById = new Map(state.players.map((p) => [p.providerPlayerId, p]));

  // One leading column for the round label, then one column per team.
  grid.style.gridTemplateColumns = `40px repeat(${numTeams}, minmax(108px, 1fr))`;

  const cells = [`<div class="dg-cell dg-head"></div>`];
  for (let slot = 1; slot <= numTeams; slot++) {
    cells.push(
      `<div class="dg-cell dg-head ${slot === myTeamSlot ? "is-me" : ""}">${slot === myTeamSlot ? "You" : `T${slot}`}</div>`
    );
  }

  for (let round = 1; round <= totalRounds; round++) {
    cells.push(`<div class="dg-cell dg-round">R${round}</div>`);
    for (let slot = 1; slot <= numTeams; slot++) {
      const pickNum = pickNumberFor(round, slot, numTeams);
      const pick = pickByNumber.get(pickNum);
      const isCurrent = pickNum === currentPick;
      const isMineCell = slot === myTeamSlot;

      if (pick) {
        const player = playerById.get(pick.providerPlayerId);
        const pos = player ? player.position : "";
        cells.push(`
          <div class="dg-cell dg-pick pos-${escapeHtml(pos)} ${isMineCell ? "is-mine" : ""}">
            <span class="dg-num">${pickNum}</span>
            <span class="dg-name">${player ? escapeHtml(player.name) : "?"}</span>
            <span class="dg-num">${escapeHtml(pos)}${player && player.team ? ` · ${escapeHtml(player.team)}` : ""}</span>
          </div>`);
      } else {
        cells.push(`
          <div class="dg-cell is-empty ${isCurrent ? "is-current" : ""} ${isMineCell ? "is-mine" : ""}">
            <span class="dg-num">${pickNum}</span>
            ${isCurrent ? `<span class="dg-name">On the clock</span>` : ""}
          </div>`);
      }
    }
  }

  grid.innerHTML = cells.join("");
}

function renderPicksTable(state) {
  const tbody = document.querySelector("#picks-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  // Most recent first — during a live draft the last few picks are what you're
  // reacting to, and scrolling to the bottom of a growing table to find them is
  // exactly the friction this view exists to remove.
  for (const pick of state.picks.slice().reverse().slice(0, 25)) {
    const player = state.players.find((p) => p.providerPlayerId === pick.providerPlayerId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${pick.pickNumber}</td>
      <td>${pick.round}</td>
      <td>${pick.teamSlot === state.myTeamSlot ? "You" : `T${pick.teamSlot}`}</td>
      <td>${player ? escapeHtml(player.name) : "?"}</td>
      <td><span class="pos-badge pos-${player ? escapeHtml(player.position) : ""}">${player ? escapeHtml(player.position) : "?"}</span></td>
    `;
    tbody.appendChild(tr);
  }
}

/** Roster-needs bars in the draft rail — the same allocation logic My Team uses, so
 * the two views can never disagree about what's still open. */
function renderNeedsRail(state) {
  const el = document.getElementById("board-needs");
  if (!el) return;
  const roster = getMyRoster(state);
  const allocation = computeSlotAllocation(roster, DEFAULT_ROSTER_SLOTS).filter(
    (a) => a.slot !== "BN" && a.slot !== "IR"
  );
  el.innerHTML = `<div class="needs-bars">${allocation
    .map(({ slot, count, filled }) => {
      const pct = count > 0 ? Math.round((filled / count) * 100) : 0;
      return `
        <div class="need-bar-row">
          <span class="need-bar-label">${escapeHtml(slot)}</span>
          <div class="need-bar-track"><div class="need-bar-fill ${filled < count ? "needs-open" : ""}" style="width:${pct}%"></div></div>
          <span class="need-bar-text">${filled}/${count}</span>
        </div>`;
    })
    .join("")}</div>`;
}

export function renderBoard() {
  const state = getDraftState();
  if (!state) return;
  renderClock(state);
  renderGrid(state);
  renderPicksTable(state);
  renderNeedsRail(state);
}
