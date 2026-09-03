#!/usr/bin/env node
// Real-data ETL — pulls free, public, official nflverse data and builds
// shared/data/players-live.json + shared/data/team-context-2026.json.
//
// Why this exists: the app previously ran entirely on
// shared/data/placeholder-players.json (synthetic names/numbers made up for UI
// testing). The user asked directly: "I don't see anything [real] there, there
// should be data there since the brain should be running fetches and scraping
// sites — implement [it]." This script is that implementation.
//
// Sources (all free, public, official — no scraping of paywalled sites, per the
// standing decision in docs/ISSUE_LOG.md "Scraping paywalled sources"):
//   - https://github.com/nflverse/nflverse-data (MIT-licensed community project
//     built on official NFL data feeds) — player identity crosswalk, weekly
//     player stats, team defense stats, season schedules (including odds), and
//     official injury reports.
// All fetched via github.com / raw.githubusercontent.com release-asset URLs,
// which ARE reachable from this build environment (verified 2026-08-03 — Yahoo,
// ESPN, Sleeper, Open-Meteo, and Kalshi are NOT reachable from here, see
// docs/DATA_SOURCES.md).
//
// HONESTY NOTE (do not remove): the 2026 season has not been played yet as of
// this writing. There is no free source of real 2026 fantasy *projections*.
// `projectedPoints` here is an ESTIMATE derived from each player's actual per-game
// scoring rate in the most recent completed season available (STATS_SEASON below)
// — it is explicitly NOT an official 2026 projection, and
// every output file says so in its own _README field so nobody downstream
// mistakes it for one. Swap in a real projections/ADP feed the moment one is
// available (see docs/DATA_SOURCES.md open items).
//
// Run: node scripts/build-player-data.mjs
// Re-run any time for a refresh — this is exactly the "daily/on-demand refresh"
// mechanism described in docs/CONTEXT.md's Phase 2 requirement, just manual for
// now (a real cron/serverless refresh is a later step once this is proven out).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "shared", "data");
const RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download";
// STATS_SEASON: the most recently *completed* season nflverse's player_stats.csv
// release actually contains — verified empirically at build time (2026-08-03) that
// this file covers seasons 1999-2024 only (2025 season stats were not yet present in
// this release asset), so 2024 is the real most-recent-complete season available from
// this free source right now, not an assumption. Re-check this if re-running later —
// nflverse updates these release assets over time.
const STATS_SEASON = 2024; // most recently completed season with real stats in this file — see honesty note above
const SCHEDULE_SEASON = 2026; // current season's schedule (already published/odds-posted)

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K"]);

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}): ${url}`);
  return await res.text();
}

/** Minimal CSV parser — tolerant of quoted fields containing commas, which is all
 * nflverse's data actually needs (no embedded newlines-in-quotes in these files). */
function parseCsv(text) {
  const lines = text.split("\n").filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length !== header.length) continue; // skip malformed trailing lines
    const row = {};
    for (let c = 0; c < header.length; c++) row[header[c]] = cells[c];
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch.replace(/\r$/, "");
    }
  }
  out.push(cur.replace(/\r$/, ""));
  return out;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** nflverse's player_stats.csv already ships a `fantasy_points_ppr` column (their own
 * official full-PPR computation) — use it directly rather than re-deriving scoring
 * from raw box-score columns, since it's the more authoritative number and matches
 * both leagues' confirmed PPR settings (docs/CONTEXT.md). */
function pprPoints(row) {
  return num(row.fantasy_points_ppr);
}

async function main() {
  console.log("Fetching player identity crosswalk (players.csv)...");
  const players = parseCsv(await fetchText(`${RELEASE_BASE}/players_components/players.csv`));

  console.log(`Fetching ${STATS_SEASON} season player stats (this is a ~33MB file, may take a bit)...`);
  const statRows = parseCsv(await fetchText(`${RELEASE_BASE}/player_stats/player_stats.csv`));

  console.log(`Fetching ${STATS_SEASON} injury reports...`);
  const injuryRows = parseCsv(
    await fetchText(`${RELEASE_BASE}/injuries/injuries_${STATS_SEASON}.csv`)
  );

  console.log(`Fetching ${SCHEDULE_SEASON} schedule (games.csv, includes posted odds + coaches)...`);
  const gameRows = parseCsv(await fetchText(`${RELEASE_BASE}/schedules/games.csv`)).filter(
    (g) => Number(g.season) === SCHEDULE_SEASON
  );

  console.log(`Fetching ${STATS_SEASON} team defense stats...`);
  const defRows = parseCsv(
    await fetchText(`${RELEASE_BASE}/player_stats/player_stats_def.csv`)
  ).filter((r) => Number(r.season) === STATS_SEASON && r.season_type === "REG");

  // --- Aggregate offensive stats per player, season totals -----------------------
  const bySeasonPlayer = new Map(); // player_id -> { games:Set<week>, totals... }
  for (const row of statRows) {
    if (Number(row.season) !== STATS_SEASON || row.season_type !== "REG") continue;
    const id = row.player_id;
    if (!id) continue;
    if (!bySeasonPlayer.has(id)) {
      bySeasonPlayer.set(id, {
        weeks: new Set(),
        pprTotal: 0,
        passingEpaSum: 0,
        passingEpaN: 0,
        rushingEpaSum: 0,
        rushingEpaN: 0,
        targets: 0,
        receptions: 0,
        receivingYards: 0,
        carries: 0,
        rushingYards: 0,
        team: row.recent_team,
      });
    }
    const acc = bySeasonPlayer.get(id);
    acc.weeks.add(row.week);
    acc.pprTotal += pprPoints(row);
    if (row.passing_epa !== "" && row.passing_epa != null) {
      acc.passingEpaSum += num(row.passing_epa);
      acc.passingEpaN += 1;
    }
    if (row.rushing_epa !== "" && row.rushing_epa != null) {
      acc.rushingEpaSum += num(row.rushing_epa);
      acc.rushingEpaN += 1;
    }
    acc.targets += num(row.targets);
    acc.receptions += num(row.receptions);
    acc.receivingYards += num(row.receiving_yards);
    acc.carries += num(row.carries);
    acc.rushingYards += num(row.rushing_yards);
    acc.team = row.recent_team || acc.team;
  }

  // --- Most recent injury designation per player ----------------------------------
  const latestInjury = new Map(); // gsis_id -> {week, status, note}
  for (const row of injuryRows) {
    if (!row.gsis_id) continue;
    const week = Number(row.week);
    const prev = latestInjury.get(row.gsis_id);
    if (!prev || week >= prev.week) {
      const note = [row.report_primary_injury, row.report_secondary_injury]
        .filter(Boolean)
        .join(", ");
      latestInjury.set(row.gsis_id, { week, status: row.report_status || null, note });
    }
  }

  // --- 2026 schedule → per-team week list, bye weeks, and week-1 odds/coach context
  const teamWeeks = new Map(); // team -> Set(week)
  const teamGamesByWeek = new Map(); // `${team}-${week}` -> game row
  let maxWeek = 0;
  for (const g of gameRows) {
    const week = Number(g.week);
    maxWeek = Math.max(maxWeek, week);
    for (const side of ["home_team", "away_team"]) {
      const team = g[side];
      if (!team) continue;
      if (!teamWeeks.has(team)) teamWeeks.set(team, new Set());
      teamWeeks.get(team).add(week);
      teamGamesByWeek.set(`${team}-${week}`, g);
    }
  }
  const byeWeekByTeam = {};
  for (const [team, weeks] of teamWeeks.entries()) {
    for (let w = 1; w <= maxWeek; w++) {
      if (!weeks.has(w)) {
        byeWeekByTeam[team] = w;
        break;
      }
    }
  }

  const teamContext = {};
  for (const [team] of teamWeeks.entries()) {
    const week1 = teamGamesByWeek.get(`${team}-1`);
    if (!week1) continue;
    const isHome = week1.home_team === team;
    const opponent = isHome ? week1.away_team : week1.home_team;
    const teamMoneyline = num(isHome ? week1.home_moneyline : week1.away_moneyline);
    const spreadLine = num(week1.spread_line); // positive = home team favored by that many? nflverse: spread_line is home-relative
    const impliedFavored = isHome ? spreadLine > 0 : spreadLine < 0;
    teamContext[team] = {
      week1Opponent: opponent,
      week1Home: isHome,
      week1Moneyline: teamMoneyline || null,
      week1SpreadLine: spreadLine || null,
      week1FavoredToWin: impliedFavored,
      week1TotalLine: num(week1.total_line) || null,
      headCoach: isHome ? week1.home_coach || null : week1.away_coach || null,
      byeWeek: byeWeekByTeam[team] ?? null,
    };
  }

  // --- Build final player list -----------------------------------------------------
  const out = [];
  for (const p of players) {
    if (p.status !== "ACT") continue;
    if (!FANTASY_POSITIONS.has(p.position)) continue;
    if (!p.latest_team) continue;
    // The crosswalk spans NFL history and occasionally leaves `status: ACT` stale on
    // long-retired players (e.g. Troy Aikman, last_season 2000) — filter to players
    // with recent activity so retired players don't show up as draftable.
    if (p.last_season && Number(p.last_season) < STATS_SEASON - 1) continue;

    const stat = bySeasonPlayer.get(p.gsis_id);
    const games = stat ? stat.weeks.size : 0;
    const ppgLastSeason = stat && games > 0 ? stat.pprTotal / games : 0;
    // Projection proxy: last season's per-game rate × a full 17-game season. Explicitly
    // an estimate, not a real projection — see the file-level honesty note above.
    const projectedPoints = Math.round(ppgLastSeason * 17 * 10) / 10;

    const injury = latestInjury.get(p.gsis_id);
    const ctx = teamContext[p.latest_team];
    // Skip deep-roster players with no recorded snaps last season and no rookie
    // status — keeps the draft pool focused instead of padded with 3rd-string
    // players the data source has nothing to say about. Rookies not yet in this
    // crosswalk at all (drafted after this file was generated) are a known gap —
    // see the file-level README.
    if (games === 0 && num(p.years_of_experience) > 0) continue;

    out.push({
      provider: "canonical",
      providerPlayerId: p.gsis_id,
      nflId: p.gsis_id,
      name: p.display_name,
      team: p.latest_team,
      position: p.position,
      college: p.college_name || null,
      headshot: p.headshot ? p.headshot.replace("{formatInstructions}", "f_auto,q_auto") : null,
      yearsExperience: num(p.years_of_experience),
      projectedPoints,
      ppgLastSeason: Math.round(ppgLastSeason * 10) / 10,
      gamesPlayedLastSeason: games,
      epaPerGamePassing:
        stat && stat.passingEpaN > 0 ? Math.round((stat.passingEpaSum / stat.passingEpaN) * 100) / 100 : null,
      epaPerGameRushing:
        stat && stat.rushingEpaN > 0 ? Math.round((stat.rushingEpaSum / stat.rushingEpaN) * 100) / 100 : null,
      targetShareRaw: stat ? stat.targets : null, // season total targets, not a true share (need team total) — see README
      receptionsLastSeason: stat ? stat.receptions : null,
      receivingYardsLastSeason: stat ? stat.receivingYards : null,
      carriesLastSeason: stat ? stat.carries : null,
      rushingYardsLastSeason: stat ? stat.rushingYards : null,
      injuryStatus: injury?.status || null,
      injuryNote: injury?.note || null,
      byeWeek: ctx?.byeWeek ?? null,
      adp: null, // no free ADP source wired in yet — see docs/DATA_SOURCES.md
    });
  }

  // --- Team defenses: simple real-data-based proxy, 32 entries -----------------------
  const defBySeason = new Map();
  for (const row of defRows) {
    const team = row.team;
    if (!defBySeason.has(team)) {
      defBySeason.set(team, { weeks: new Set(), sacks: 0, ints: 0, fumRec: 0, tds: 0, safeties: 0 });
    }
    const acc = defBySeason.get(team);
    acc.weeks.add(row.week);
    acc.sacks += num(row.def_sacks);
    acc.ints += num(row.def_interceptions);
    acc.fumRec += num(row.def_fumble_recovery_opp);
    acc.tds += num(row.def_tds);
    acc.safeties += num(row.def_safety);
  }
  for (const [team, acc] of defBySeason.entries()) {
    const games = acc.weeks.size || 1;
    // Simplified team-defense PPR-ish scoring (sacks/turnovers/TDs only — points-
    // allowed tiers need a separate schedule join, left as a TODO, see README below).
    const seasonTotal = acc.sacks * 1 + acc.ints * 2 + acc.fumRec * 2 + acc.tds * 6 + acc.safeties * 2;
    const perGame = seasonTotal / games;
    out.push({
      provider: "canonical",
      providerPlayerId: `DEF-${team}`,
      nflId: null,
      name: `${team} Defense`,
      team,
      position: "DEF",
      projectedPoints: Math.round(perGame * 17 * 10) / 10,
      ppgLastSeason: Math.round(perGame * 10) / 10,
      gamesPlayedLastSeason: games,
      byeWeek: teamContext[team]?.byeWeek ?? null,
      adp: null,
    });
  }

  out.sort((a, b) => b.projectedPoints - a.projectedPoints);

  const generatedAt = new Date().toISOString();
  const playersFile = {
    _README:
      "REAL DATA, not synthetic — pulled from nflverse-data (github.com/nflverse/nflverse-data), " +
      "a community project built on official NFL data feeds. `projectedPoints` and `ppgLastSeason` are " +
      `derived from each player's actual ${STATS_SEASON} regular-season per-game scoring rate ` +
      "(full-PPR) projected forward — this is an ESTIMATE, explicitly NOT an official " +
      `${SCHEDULE_SEASON} fantasy projection (none exists yet from a free source as of ` +
      "this build — see docs/DATA_SOURCES.md). Team-defense scores are a simplified " +
      "sacks/turnovers/TDs proxy only, not a full points-allowed model yet. Injury fields " +
      `reflect the last reported ${STATS_SEASON}-season designation on file for that ` +
      "player, not a live current-week report. Regenerate with " +
      "`node scripts/build-player-data.mjs` for a refresh.",
    generatedAt,
    statsSeasonUsed: STATS_SEASON,
    scheduleSeasonUsed: SCHEDULE_SEASON,
    sourceUrls: [
      `${RELEASE_BASE}/players_components/players.csv`,
      `${RELEASE_BASE}/player_stats/player_stats.csv`,
      `${RELEASE_BASE}/player_stats/player_stats_def.csv`,
      `${RELEASE_BASE}/injuries/injuries_${STATS_SEASON}.csv`,
      `${RELEASE_BASE}/schedules/games.csv`,
    ],
    players: out,
  };

  const teamContextFile = {
    _README:
      `REAL DATA — ${SCHEDULE_SEASON} schedule, bye weeks, and Week 1 posted odds/coaches, ` +
      "pulled from nflverse-data's games.csv (official schedule + market odds feeds). " +
      "spread_line/moneyline reflect whatever was posted at fetch time and will move before " +
      "kickoff — treat as directional context, not a live line. Regenerate with " +
      "`node scripts/build-player-data.mjs` for a refresh.",
    generatedAt,
    scheduleSeasonUsed: SCHEDULE_SEASON,
    teams: teamContext,
  };

  writeFileSync(join(OUT_DIR, "players-live.json"), JSON.stringify(playersFile, null, 2));
  writeFileSync(join(OUT_DIR, "team-context-2026.json"), JSON.stringify(teamContextFile, null, 2));

  console.log(`Wrote ${out.length} players to shared/data/players-live.json`);
  console.log(`Wrote ${Object.keys(teamContext).length} teams to shared/data/team-context-2026.json`);
}

main().catch((err) => {
  console.error("build-player-data.mjs failed:", err);
  process.exitCode = 1;
});
