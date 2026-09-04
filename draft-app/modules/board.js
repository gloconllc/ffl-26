// Draft Board's picks table — the running log of every pick, most recent first.
import { getDraftState, currentPickNumber, teamSlotForPick, isMyPick } from "../../shared/draft-state.js";
import { escapeHtml } from "./dom-utils.js";

export function renderBoard() {
  const state = getDraftState();
  if (!state) return;

  const pickNum = currentPickNumber(state);
  const { round, teamSlot } = teamSlotForPick(pickNum, state.numTeams);
  const mine = isMyPick(state);
  const clockEl = document.getElementById("on-the-clock");
  if (clockEl) {
    clockEl.textContent = `Pick ${pickNum} · Round ${round} · Team ${teamSlot}${mine ? " (YOU)" : ""}`;
    clockEl.className = `status ${mine ? "status-connected" : "status-pending"}`;
  }

  const tbody = document.querySelector("#picks-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const pick of state.picks.slice().reverse()) {
    const player = state.players.find((p) => p.providerPlayerId === pick.providerPlayerId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${pick.pickNumber}</td>
      <td>${pick.round}</td>
      <td>${pick.teamSlot}${pick.teamSlot === state.myTeamSlot ? " (you)" : ""}</td>
      <td>${player ? escapeHtml(player.name) : "?"}</td>
      <td><span class="pos-badge pos-${player ? escapeHtml(player.position) : ""}">${player ? escapeHtml(player.position) : "?"}</span></td>
    `;
    tbody.appendChild(tr);
  }
}
