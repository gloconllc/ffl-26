// Scoring/ranking, the Recommendation tab, the Draft Board's live sidebar card, and
// the personal-preference layer. This is the app's "brain" surface — it doesn't
// change any of the underlying statistics (those live in shared/scoring-engine.js
// and shared/draft-state.js), it's the ranking/presentation logic around them.
import {
  getDraftState,
  isMyPick,
  currentPickNumber,
  teamSlotForPick,
  getAvailablePlayers,
  getRosterNeeds,
  getMyRoster,
  recordPick,
} from "../../shared/draft-state.js";
import { scorePlayer, buildScoringCaches } from "../../shared/scoring-engine.js";
import { getPreferences, findMatchingPreference } from "../../shared/preferences.js";
import { applyPreferenceLayer, acknowledgeOverride } from "../../shared/preference-engine.js";
import { notifyAppChange } from "../../shared/store.js";
import {
  safe,
  withBusy,
  escapeHtml,
  logDebug,
  playerAvatarHtml,
  injuryBadgeHtml,
  renderTierBars,
  tierChipHtml,
  marketBadgeHtml,
} from "./dom-utils.js";
import { getWeights, getStrategyPreset, effectiveNeedAwareness } from "./settings.js";
import { getCachedTeamContext } from "./player-data.js";
import { marketForTeam, trendFor } from "../../shared/kalshi-client.js";

/** Same-team "stacking" downside: rostering multiple players from the same NFL team
 * correlates their weekly outcomes (one bad game plan drags both down together) and,
 * when bye weeks match exactly, benches both in the same week with no way to cover it.
 * Not a hard block — real drafters do sometimes stack on purpose — just a bias, scaled
 * by the same `needAwareness` factor as positional needs so "The Brain" (pure
 * best-player-available, explicitly documented as ignoring roster context) stays
 * exactly that: pure. Returns { amount, note } — amount is a sort-key penalty in the
 * same units as score, note is a user-facing explanation or null. */
export function stackingPenalty(player, myRoster, needAwareness, maxScore) {
  if (!needAwareness || !myRoster.length) return { amount: 0, note: null };
  const teammates = myRoster.filter((p) => p.team && p.team === player.team);
  if (!teammates.length) return { amount: 0, note: null };
  // Check every same-team match, not just the first — a bye-week collision with the
  // 2nd or 3rd teammate on this team is just as real a risk as one with the 1st, and
  // should take priority over a merely-correlated (different-bye) match if any exists.
  const byeCollision = teammates.find((p) => Boolean(p.byeWeek) && p.byeWeek === player.byeWeek);
  const teammate = byeCollision || teammates[0];
  const sameBye = Boolean(byeCollision);
  const fraction = sameBye ? 0.35 : 0.15;
  const note = sameBye
    ? `Same team AND bye week (${player.byeWeek}) as your ${teammate.name} — you'd lose both in the same week.`
    : `Also on ${player.team} with your ${teammate.name} on your roster — correlated outcomes, less week-to-week insurance.`;
  return { amount: needAwareness * fraction * maxScore, note };
}

/** Sort by score plus a need boost scaled by `needAwareness` (0..1). At 1, any
 * need-filling player's boost (max score in the pool) guarantees it outranks every
 * non-need player. At 0, boost is zero for everyone — pure score order. `myRoster` is
 * optional — when provided, same-team stacking is penalized the same way. */
export function sortByStrategy(ranked, neededPositions, needAwareness, myRoster = []) {
  const maxScore = ranked.length ? Math.max(...ranked.map((r) => r.scoreResult.score), 1) : 1;
  return ranked
    .slice()
    .sort((a, b) => {
      const aBoost = neededPositions.has(a.player.position) ? needAwareness * maxScore : 0;
      const bBoost = neededPositions.has(b.player.position) ? needAwareness * maxScore : 0;
      const aStack = stackingPenalty(a.player, myRoster, needAwareness, maxScore).amount;
      const bStack = stackingPenalty(b.player, myRoster, needAwareness, maxScore).amount;
      return b.scoreResult.score + bBoost - bStack - (a.scoreResult.score + aBoost - aStack);
    });
}

// PERFORMANCE-CRITICAL (see shared/scoring-engine.js's buildScoringCaches doc
// comment): the replacement-level/tier/VORP-pool passes are each O(n log n) over the
// ~800-player real pool. Compute them ONCE per ranking pass and reuse for every
// player. Memoized per render cycle since three separate panels (Available Players,
// Recommendation, Board sidebar) all need the same ranking on every render.
let scoredAvailableCache = null; // { key, result }
function scoredAvailableCacheKey(state) {
  return `${state.picks.length}:${JSON.stringify(getWeights())}`;
}
export function clearScoredAvailableCache() {
  scoredAvailableCache = null;
}
export function scoredAvailable(state) {
  const key = scoredAvailableCacheKey(state);
  if (scoredAvailableCache && scoredAvailableCache.key === key) return scoredAvailableCache.result;

  const available = getAvailablePlayers(state);
  const weights = getWeights();
  const leagueSettings = {
    numTeams: state.numTeams,
    startersPerTeamByPosition: { QB: 1, RB: 2.5, WR: 2.5, TE: 1, K: 1, DEF: 1 },
  };
  const caches = buildScoringCaches(available, leagueSettings);
  const result = available
    .map((p) => ({
      player: p,
      scoreResult: scorePlayer(
        p,
        { allPlayersAtPosition: available, leagueSettings, teamContext: getCachedTeamContext() || {}, ...caches },
        weights
      ),
    }))
    .sort((a, b) => b.scoreResult.score - a.scoreResult.score);

  scoredAvailableCache = { key, result };
  return result;
}

export function renderAvailablePlayers() {
  const state = getDraftState();
  const tbody = document.querySelector("#available-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!state) {
    tbody.innerHTML = `<tr><td colspan="8"><p class="hint" style="margin:0">Start a draft in the Draft Room to rank the available pool. The Overview tab's cheat sheet works right now without one.</p></td></tr>`;
    return;
  }

  const filterEl = document.getElementById("position-filter");
  const filter = filterEl ? filterEl.value : "ALL";
  const searchEl = document.getElementById("player-search");
  const query = searchEl ? searchEl.value.trim().toLowerCase() : "";
  const ranked = scoredAvailable(state).filter(
    (r) =>
      (filter === "ALL" || r.player.position === filter) &&
      (!query || r.player.name.toLowerCase().includes(query) || (r.player.team || "").toLowerCase().includes(query))
  );

  // Real-time draft-day mode: the Draft button logs whichever team's turn it
  // currently is (per teamSlotForPick), not only "your" pick. This lets you click
  // the instant you see a pick happen on Yahoo's/ESPN's own screen — yours or an
  // opponent's — instead of waiting on live API polling we can't safely ship
  // untested. recordPick()/teamSlotForPick() already resolve the correct team from
  // the current pick count, so no auto-detection is needed.
  const mine = isMyPick(state);
  const pickNum = currentPickNumber(state);
  const { teamSlot } = teamSlotForPick(pickNum, state.numTeams);
  const draftBtnLabel = mine ? "Draft" : `Log T${teamSlot}`;
  ranked.slice(0, 80).forEach(({ player, scoreResult }, i) => {
    const market = marketForTeam(player.team);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-rank">${i + 1}</td>
      <td>
        <div class="player-cell">
          ${playerAvatarHtml(player)}
          <span class="player-name">${escapeHtml(player.name)}</span>
          ${injuryBadgeHtml(player)}
          ${market ? marketBadgeHtml(market, trendFor(market.ticker)) : ""}
        </div>
      </td>
      <td><span class="pos-badge pos-${escapeHtml(player.position)}">${escapeHtml(player.position)}</span></td>
      <td>${escapeHtml(player.team)}${player.byeWeek ? ` <span class="tag">bye ${escapeHtml(player.byeWeek)}</span>` : ""}</td>
      <td>${tierChipHtml(scoreResult.tier)}</td>
      <td class="numeric">${scoreResult.vorp.toFixed(1)}</td>
      <td class="numeric"><strong>${scoreResult.score.toFixed(0)}</strong></td>
      <td><button class="btn btn-sm ${mine ? "btn-primary" : "btn-ghost"} btn-draft" data-player="${player.providerPlayerId}" title="Logs this pick for whichever team is currently on the clock">${draftBtnLabel}</button></td>
    `;
    tbody.appendChild(tr);
  });

  if (!ranked.length) {
    tbody.innerHTML = `<tr><td colspan="8"><p class="hint" style="margin:0">No players match that filter.</p></td></tr>`;
  }

  wireDraftButtons(tbody);
}

/** Compact best-available list for the Draft Room, so the main draft screen shows who
 * to take without switching tabs. Same ranking as the Players tab, always. */
export function renderBestAvailable() {
  const el = document.getElementById("board-best-available");
  if (!el) return;
  const state = getDraftState();
  if (!state) {
    el.innerHTML = `<p class="hint" style="margin-top:0">Start a draft to see the board fill in.</p>`;
    return;
  }

  const view = computeRecommendationView();
  const ranked = view.status === "ready" ? view.ranked : scoredAvailable(state);
  const mine = isMyPick(state);

  el.innerHTML = `
    <div class="table-scroll">
      <table class="data-table compact">
        <thead><tr><th class="col-rank">#</th><th>Player</th><th>Pos</th><th>Team</th><th>Tier</th><th class="numeric">Score</th><th></th></tr></thead>
        <tbody>
          ${ranked
            .slice(0, 12)
            .map(
              ({ player, scoreResult }, i) => `
            <tr>
              <td class="col-rank">${i + 1}</td>
              <td><div class="player-cell">${playerAvatarHtml(player)}<span class="player-name">${escapeHtml(player.name)}</span>${injuryBadgeHtml(player)}</div></td>
              <td><span class="pos-badge pos-${escapeHtml(player.position)}">${escapeHtml(player.position)}</span></td>
              <td>${escapeHtml(player.team)}</td>
              <td>${tierChipHtml(scoreResult.tier)}</td>
              <td class="numeric"><strong>${scoreResult.score.toFixed(0)}</strong></td>
              <td><button class="btn btn-sm ${mine ? "btn-primary" : "btn-ghost"} btn-draft" data-player="${player.providerPlayerId}">${mine ? "Draft" : "Log"}</button></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;

  wireDraftButtons(el);
}

/** Position chips + search box on the Players tab. The chips write through to the
 * (visually hidden) native select so the existing change-event wiring keeps working
 * and the control stays keyboard/screen-reader accessible. */
export function initPlayerFilters() {
  const select = document.getElementById("position-filter");
  const chips = document.querySelectorAll(".pos-filter");
  chips.forEach((chip) => {
    chip.addEventListener(
      "click",
      safe(() => {
        chips.forEach((c) => c.classList.toggle("is-active", c === chip));
        if (select) {
          select.value = chip.dataset.pos;
          select.dispatchEvent(new Event("change"));
        }
      }, "filter by position")
    );
  });

  const search = document.getElementById("player-search");
  if (search) {
    search.addEventListener("input", safe(renderAvailablePlayers, "search players"));
  }
}

export function draftPlayer(providerPlayerId) {
  // Deliberately no isMyPick() gate: draft-day mode lets you log ANY team's pick the
  // moment it happens on Yahoo's/ESPN's own site, in real time. recordPick() below
  // resolves the correct team from the current pick count regardless of whose turn
  // it is.
  const state = getDraftState();
  if (!state) return;
  recordPick(state, providerPlayerId, "manual");
  notifyAppChange();
}

function recCardHtml(player, scoreResult, rank, myRoster = []) {
  const isCliffLine = (r) => r.includes("left in this tier");
  const cliffLine = scoreResult.reasoning.find(isCliffLine);
  const reasoningItems = scoreResult.reasoning
    .filter((r) => !isCliffLine(r))
    .map((r) => `<li>${r}</li>`)
    .join("");
  const cliff = cliffLine ? `<li class="cliff-warning">⚠ ${cliffLine}</li>` : "";
  // Surface same-team stacking as a plain fact regardless of Mode — only the ranking
  // itself is mode-dependent (see stackingPenalty/sortByStrategy); the warning below
  // is informational so you can make the call yourself even under "The Brain".
  const stackNote = stackingPenalty(player, myRoster, 1, 1).note;
  const stackWarning = stackNote ? `<li class="cliff-warning">⚠ ${escapeHtml(stackNote)}</li>` : "";
  const tierBars = scoreResult.tierBreakdown ? renderTierBars(scoreResult.tierBreakdown) : "";
  const market = marketForTeam(player.team);
  return `
    <div class="rec-card rank-${rank}">
      <h4>
        <span class="rec-rank">#${rank}</span>
        ${escapeHtml(player.name)}
        <span class="pos-badge pos-${escapeHtml(player.position)}">${escapeHtml(player.position)}</span>
        <span class="pill">${escapeHtml(player.team)}</span>
        ${tierChipHtml(scoreResult.tier)}
        ${injuryBadgeHtml(player)}
        ${market ? marketBadgeHtml(market, trendFor(market.ticker)) : ""}
      </h4>
      ${tierBars}
      <ul>${reasoningItems}${cliff}${stackWarning}</ul>
      <button class="btn btn-primary btn-draft" data-player="${player.providerPlayerId}">Draft this player</button>
    </div>
  `;
}

function wireDraftButtons(container) {
  container.querySelectorAll(".btn-draft").forEach((btn) => {
    btn.addEventListener(
      "click",
      safe(() => withBusy(btn, () => draftPlayer(btn.dataset.player)), "draft player")
    );
  });
}

/** All the ranking/compare logic, shared between the full Recommendation tab and the
 * compact live sidebar on the Draft Board tab — both must always agree, since showing
 * two different "top picks" at once would be worse than showing just one. */
function computeRecommendationView() {
  const state = getDraftState();
  if (!state) return { status: "no-draft" };
  if (!isMyPick(state)) {
    const pickNum = currentPickNumber(state);
    const { teamSlot, round } = teamSlotForPick(pickNum, state.numTeams);
    return { status: "not-my-turn", pickNum, teamSlot, round };
  }

  const needs = getRosterNeeds(state, state.myTeamSlot);
  const neededPositions = new Set(needs.flatMap((n) => n.eligiblePositions));
  const scored = scoredAvailable(state);
  const myRoster = getMyRoster(state);

  const preset = getStrategyPreset();
  const needAwareness = effectiveNeedAwareness();
  const ranked = sortByStrategy(scored, neededPositions, needAwareness, myRoster);

  const recommendedTop = sortByStrategy(scored, neededPositions, 1, myRoster)[0];
  const brainTop = sortByStrategy(scored, neededPositions, 0, myRoster)[0];

  return { status: "ready", preset, ranked, recommendedTop, brainTop, myRoster };
}

export function renderRecommendation() {
  const container = document.getElementById("recommendation-content");
  const prefContainer = document.getElementById("preference-layer-content");
  if (!container) return;

  const view = computeRecommendationView();

  if (view.status === "no-draft") {
    container.innerHTML = `<p class="hint">Start a draft on the Draft Board tab first.</p>`;
    if (prefContainer) prefContainer.innerHTML = "";
    return;
  }
  if (view.status === "not-my-turn") {
    container.innerHTML = `<p class="hint">Waiting — pick ${view.pickNum} (round ${view.round}) belongs to Team ${view.teamSlot}. Use "Simulate to my turn" on the Draft Board tab in practice mode.</p>`;
    if (prefContainer) prefContainer.innerHTML = "";
    return;
  }

  const { preset, ranked, recommendedTop, brainTop } = view;

  // Show the honest delta between "Recommended" and "The Brain" whenever they'd
  // actually pick differently right now — this is the whole point of the preset
  // selector: see the difference before you commit to a pick, not after.
  let modeCompareHtml = "";
  if (recommendedTop && brainTop && recommendedTop.player.providerPlayerId !== brainTop.player.providerPlayerId) {
    modeCompareHtml = `
      <div class="card">
        <p class="hint"><strong>Recommended</strong> would take <strong>${escapeHtml(recommendedTop.player.name)}</strong> (${escapeHtml(recommendedTop.player.position)}, fills a need) —
        <strong>The Brain</strong> would take <strong>${escapeHtml(brainTop.player.name)}</strong> (${escapeHtml(brainTop.player.position)}, ${brainTop.scoreResult.score.toFixed(1)} VORP, highest pure score regardless of need).
        You're currently viewing recommendations under <strong>${preset === "recommended" ? "Recommended" : preset === "brain" ? "The Brain" : "Custom"}</strong>.</p>
      </div>`;
  }

  const top3 = ranked.slice(0, 3);
  container.innerHTML =
    modeCompareHtml +
    top3.map(({ player, scoreResult }, i) => recCardHtml(player, scoreResult, i + 1, view.myRoster)).join("");

  wireDraftButtons(container);
  renderPreferenceLayer(ranked);
}

/** Compact version of the same recommendation, rendered into the Draft Board tab's
 * sidebar so the board and the recommendation are visible at the same time — no tab
 * switching mid-pick. Always reflects the exact same ranking as the full tab. */
export function renderBoardRecommendation() {
  const container = document.getElementById("board-rec-content");
  if (!container) return;

  const view = computeRecommendationView();

  if (view.status === "no-draft") {
    container.innerHTML = `<p class="hint">Start a draft to see live recommendations here.</p>`;
    return;
  }
  if (view.status === "not-my-turn") {
    container.innerHTML = `<p class="hint">Waiting on Team ${view.teamSlot} (pick ${view.pickNum}, round ${view.round}).</p>`;
    return;
  }

  const top = view.ranked[0];
  if (!top) {
    container.innerHTML = `<p class="hint">No players left to rank.</p>`;
    return;
  }
  container.innerHTML = recCardHtml(top.player, top.scoreResult, 1, view.myRoster);
  wireDraftButtons(container);
}

// --- Personal preference layer ------------------------------------------------------
// Founding requirement: show the model's real #1 pick under the currently selected
// strategy mode, show the user's stated preference if one is still available, show
// the honest delta, let the user decide — never blend the bias into the model's own
// number, and never punish a future recommendation for having overridden this one.
function renderPreferenceLayer(ranked) {
  const container = document.getElementById("preference-layer-content");
  if (!container || !ranked.length) {
    if (container) container.innerHTML = "";
    return;
  }

  const prefs = getPreferences();
  const availablePlayers = ranked.map((r) => r.player);
  const match = findMatchingPreference(prefs, availablePlayers);
  const result = applyPreferenceLayer(ranked[0], match, ranked);

  if (!result) {
    container.innerHTML = "";
    return;
  }

  if (result.aligned) {
    container.innerHTML = `<div class="card"><p class="hint">✓ ${escapeHtml(result.message)}</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="card">
      <h3>Your stated preference vs. the model</h3>
      <p class="hint">${escapeHtml(result.message)}</p>
      <div class="card-row">
        <button class="btn btn-primary btn-draft" data-player="${result.modelPick.player.providerPlayerId}">
          Take the model's pick — ${escapeHtml(result.modelPick.player.name)}
        </button>
        <button class="btn btn-ghost btn-draft-override" data-player="${result.preferredPick.player.providerPlayerId}" data-name="${escapeHtml(result.preferredPick.player.name)}">
          Override — take ${escapeHtml(result.preferredPick.player.name)}
        </button>
      </div>
    </div>
  `;

  wireDraftButtons(container);
  container.querySelectorAll(".btn-draft-override").forEach((btn) => {
    btn.addEventListener(
      "click",
      safe(() =>
        withBusy(btn, () => {
          logDebug("Preference override", acknowledgeOverride(btn.dataset.name));
          draftPlayer(btn.dataset.player);
        })
      , "override preference")
    );
  });
}
