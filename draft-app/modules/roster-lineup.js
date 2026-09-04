// My Roster + Lineup tabs, and the Yahoo/ESPN/local roster-source picker that feeds
// both of them.
import { computeSlotAllocation } from "../../shared/draft-state.js";
import { DEFAULT_ROSTER_SLOTS } from "../../shared/data-sources.js";
import { scorePlayer, buildScoringCaches } from "../../shared/scoring-engine.js";
import {
  getRosterSource,
  setRosterSource,
  clearRosterCache,
  resolveMyRoster,
} from "../../shared/roster-source.js";
import { getEspnTeams, getSavedEspnTeamId, saveEspnTeamId } from "../../shared/espn-roster.js";
import { getDraftState } from "../../shared/draft-state.js";
import { notifyAppChange } from "../../shared/store.js";
import { safe, withBusy, escapeHtml, showErrorBanner, playerAvatarHtml } from "./dom-utils.js";
import { getWeights } from "./settings.js";
import { loadPlayers, getCachedPlayers, getCachedTeamContext } from "./player-data.js";

/** All starting slots (not just open ones) with filled/total counts, for the roster
 * needs progress-bar visualization — takes a plain roster array directly (rather than
 * reading it off draft-state) so this same function works for My Roster/Lineup
 * sourced from a live Yahoo/ESPN fetch, which has no local draft-state at all.
 * Delegates the actual allocation to shared/draft-state.js's computeSlotAllocation()
 * — the single source of truth for slot-fill counting. */
function computeSlotStatusFromRoster(roster, rosterSlots = DEFAULT_ROSTER_SLOTS) {
  return computeSlotAllocation(roster, rosterSlots)
    .filter((a) => a.slot !== "BN" && a.slot !== "IR")
    .map((a) => ({ slot: a.slot, count: a.count, filled: a.filled }));
}

function renderNeedsBars(slotStatus) {
  const rows = slotStatus
    .map(({ slot, count, filled }) => {
      const pct = count > 0 ? Math.round((filled / count) * 100) : 0;
      const openCls = filled < count ? "needs-open" : "";
      return `
        <div class="need-bar-row">
          <span class="need-bar-label">${slot}</span>
          <div class="need-bar-track"><div class="need-bar-fill ${openCls}" style="width:${pct}%"></div></div>
          <span class="need-bar-text">${filled}/${count} filled</span>
        </div>`;
    })
    .join("");
  return `<div class="needs-bars">${rows}</div>`;
}

/** Both My Roster and Lineup need "the current roster, regardless of where it comes
 * from" — this is the one place that resolves it, so both tabs always agree. */
async function getCurrentRosterView() {
  const state = getDraftState();
  const players = getCachedPlayers() || (await loadPlayers());
  const result = await resolveMyRoster(state, players);
  const warningEl = document.getElementById("roster-source-warning");
  if (warningEl) warningEl.textContent = result.warning || "";
  return result;
}

export function renderRoster() {
  getCurrentRosterView()
    .then(({ players: roster }) => {
      const container = document.getElementById("roster-content");
      if (!container) return;
      if (!roster.length) {
        container.innerHTML = `<p class="hint">No roster yet — start a draft on the Draft Board tab, or pick a connected Yahoo/ESPN source above.</p>`;
        return;
      }

      const slotStatus = computeSlotStatusFromRoster(roster);
      const rosterRows = roster
        .map(
          (p) =>
            `<tr><td class="player-cell">${playerAvatarHtml(p)}<span>${escapeHtml(p.name)}</span></td><td><span class="pos-badge pos-${escapeHtml(p.position)}">${escapeHtml(p.position)}</span></td><td>${escapeHtml(p.team)}${p.byeWeek ? ` <span class="tag">bye ${escapeHtml(p.byeWeek)}</span>` : ""}</td></tr>`
        )
        .join("");

      container.innerHTML = `
        <h3>Roster needs</h3>
        ${renderNeedsBars(slotStatus)}
        <table class="data-table">
          <thead><tr><th>Player</th><th>Pos</th><th>Team</th></tr></thead>
          <tbody>${rosterRows || `<tr><td colspan="3">No picks yet.</td></tr>`}</tbody>
        </table>
      `;
    })
    .catch((err) => showErrorBanner("rendering roster", err));
}

/** Lineup: within each real roster slot (QB, RB, WR, TE, FLEX, K, DEF), rank the
 * eligible rostered players by the same scoring engine used everywhere else in the
 * app and mark the top `count` as Start, the rest as Bench. Bye-week starters are
 * flagged explicitly rather than silently recommended. This is honestly scoped as a
 * "best player available per slot" ranking, NOT a true week-by-week matchup
 * optimizer — see the Lineup tab's own hint text for why. */
export function renderLineup() {
  getCurrentRosterView()
    .then(async ({ players: roster }) => {
      const container = document.getElementById("lineup-content");
      if (!container) return;
      if (!roster.length) {
        container.innerHTML = `<p class="hint">No roster yet — draft on the Draft tab, or connect Yahoo/ESPN on the Roster tab, first.</p>`;
        return;
      }

      // Score against the full league player pool — not just the ~15 players on this
      // roster — so percentile/tier/VORP math (all relative measures) isn't skewed by
      // a tiny sample. Same pool renderAvailablePlayers() uses. Also read the real
      // league size off draft-state when one exists, instead of always assuming 10
      // teams.
      const state = getDraftState();
      const cachedPlayers = getCachedPlayers();
      const pool = cachedPlayers && cachedPlayers.length ? cachedPlayers : roster;
      const leagueSettings = {
        numTeams: state?.numTeams || 10,
        startersPerTeamByPosition: { QB: 1, RB: 2.5, WR: 2.5, TE: 1, K: 1, DEF: 1 },
      };
      const caches = buildScoringCaches(pool, leagueSettings);
      const weights = getWeights();
      const scoredRoster = roster
        .map((player) => ({
          player,
          scoreResult: scorePlayer(
            player,
            { allPlayersAtPosition: pool, leagueSettings, teamContext: getCachedTeamContext() || {}, ...caches },
            weights
          ),
        }))
        .sort((a, b) => b.scoreResult.score - a.scoreResult.score);

      // Assign each rostered player to at most one Start slot via the same shared
      // allocation logic as My Roster's needs bars (computeSlotAllocation) — this
      // guarantees a correct result regardless of the order roster slots happen to be
      // declared in. Feed it the players in score-sorted order (highest first) so
      // each slot's allocation naturally picks its best eligible player(s) first.
      const scoreByPlayerId = new Map(scoredRoster.map((r) => [r.player.providerPlayerId, r]));
      const playersByScore = scoredRoster.map((r) => r.player);
      const allocation = computeSlotAllocation(playersByScore, DEFAULT_ROSTER_SLOTS).filter(
        (a) => a.slot !== "BN" && a.slot !== "IR"
      );
      const startedIds = new Set();
      const slotSections = allocation.map((a) => {
        const starters = a.players.map((p) => scoreByPlayerId.get(p.providerPlayerId)).filter(Boolean);
        starters.forEach((r) => startedIds.add(r.player.providerPlayerId));
        return { slotDef: { slot: a.slot, count: a.count }, starters };
      });
      const bench = scoredRoster.filter((r) => !startedIds.has(r.player.providerPlayerId));

      const rowHtml = (r, isStarter) => `
          <tr class="${isStarter ? "lineup-start" : "lineup-bench"}">
            <td class="player-cell">${playerAvatarHtml(r.player)}<span>${escapeHtml(r.player.name)}</span></td>
            <td><span class="pos-badge pos-${escapeHtml(r.player.position)}">${escapeHtml(r.player.position)}</span></td>
            <td>${escapeHtml(r.player.team)}${r.player.byeWeek ? ` <span class="tag">bye ${escapeHtml(r.player.byeWeek)}</span>` : ""}</td>
            <td class="numeric"><strong>${r.scoreResult.score.toFixed(0)}</strong></td>
            <td>${isStarter ? '<span class="tag tag-start">Start</span>' : '<span class="tag tag-bench">Bench</span>'}</td>
          </tr>`;

      const slotsHtml = slotSections
        .map(({ slotDef, starters }) => {
          if (!starters.length) {
            return `<h4>${slotDef.slot}</h4><p class="hint">No eligible player rostered for this slot.</p>`;
          }
          return `<h4>${slotDef.slot}</h4><table class="data-table"><tbody>${starters
            .map((r) => rowHtml(r, true))
            .join("")}</tbody></table>`;
        })
        .join("");

      const benchHtml = bench.length
        ? `<h4>Bench</h4><table class="data-table"><tbody>${bench.map((r) => rowHtml(r, false)).join("")}</tbody></table>`
        : "";

      container.innerHTML = slotsHtml + benchHtml;
    })
    .catch((err) => showErrorBanner("rendering lineup", err));
}

// --- Roster source (Yahoo / ESPN / local) ------------------------------------------
// Drives both My Roster and Lineup — see shared/roster-source.js for the resolution
// logic and shared/espn-roster.js for why ESPN needs a one-time manual team pick
// (unlike Yahoo, ESPN's API gives the client no way to auto-detect "which team is
// mine").
export function initRosterSource() {
  const select = document.getElementById("roster-source-select");
  const refreshBtn = document.getElementById("roster-refresh-btn");
  const espnPicker = document.getElementById("espn-team-picker");
  const espnPickerList = document.getElementById("espn-team-picker-list");
  if (!select) return;

  select.value = getRosterSource();

  async function loadEspnTeamChoices() {
    if (!espnPickerList) return;
    espnPickerList.innerHTML = `<span class="hint">Loading ESPN teams…</span>`;
    try {
      const teams = await getEspnTeams();
      const savedId = getSavedEspnTeamId();
      // t.name is a real ESPN team display name — genuinely external, user-controlled
      // text (any league member can rename their team to anything) — must be escaped.
      espnPickerList.innerHTML = teams
        .map(
          (t) =>
            `<button class="btn ${t.id === savedId ? "btn-primary" : "btn-ghost"}" data-team-id="${t.id}" type="button">${escapeHtml(t.name)}${t.id === savedId ? " ✓" : ""}</button>`
        )
        .join("");
      espnPickerList.querySelectorAll("button[data-team-id]").forEach((btn) => {
        btn.addEventListener(
          "click",
          safe(() => {
            saveEspnTeamId(Number(btn.dataset.teamId));
            clearRosterCache("espn");
            loadEspnTeamChoices();
            notifyAppChange();
          }, "pick ESPN team")
        );
      });
    } catch (err) {
      espnPickerList.innerHTML = `<span class="hint">Couldn't load ESPN teams: ${escapeHtml(err.message)}</span>`;
    }
  }

  function updateEspnPickerVisibility() {
    if (!espnPicker) return;
    espnPicker.hidden = select.value !== "espn";
    if (!espnPicker.hidden) loadEspnTeamChoices();
  }
  updateEspnPickerVisibility();

  select.addEventListener(
    "change",
    safe(() => {
      setRosterSource(select.value);
      updateEspnPickerVisibility();
      notifyAppChange();
    }, "change roster source")
  );

  if (refreshBtn) {
    refreshBtn.addEventListener(
      "click",
      safe(() =>
        withBusy(refreshBtn, async () => {
          clearRosterCache();
          notifyAppChange();
        }),
        "refresh roster"
      )
    );
  }
}
