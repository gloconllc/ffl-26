// Matches a player name coming back from an external source (Yahoo, ESPN — each with
// their own naming quirks: suffixes, punctuation, "Jr."/"III", accented characters) to
// our local canonical player dataset (shared/data/players-live.json). Both Yahoo and
// ESPN roster sync need this same normalization, so it lives here once rather than
// being duplicated per-provider.

/** Lowercase, strip punctuation/diacritics/suffixes, collapse whitespace — turns
 * "A.J. Brown Jr." and "aj brown" into the same comparable string. */
export function normalizeName(name) {
  if (!name) return "";
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Finds the best match for an external player (name + optional position/team hints)
 * within the local canonical dataset. Exact normalized-name match first; falls back to
 * last-name + position match (covers "Josh Allen" vs "J. Allen"-style abbreviations
 * some providers use in display contexts) — never falls back to name-only-fuzzy beyond
 * that, since a wrong match is worse than no match for scoring purposes.
 *
 * @param {{name: string, position?: string, team?: string}} externalPlayer
 * @param {Array} localPlayers - shared/data/players-live.json's `players` array
 * @returns {object|null} the matching local player record, or null
 */
export function matchPlayerToLocalDataset(externalPlayer, localPlayers) {
  const targetName = normalizeName(externalPlayer.name);
  if (!targetName) return null;

  const exact = localPlayers.find((p) => normalizeName(p.name) === targetName);
  if (exact) return exact;

  // Fallback: last word of the name (last name) + position, when we have a position
  // hint. Guards against ambiguous common last names by requiring position to match.
  if (externalPlayer.position) {
    const targetLast = targetName.split(" ").slice(-1)[0];
    const candidates = localPlayers.filter(
      (p) =>
        p.position === externalPlayer.position &&
        normalizeName(p.name).split(" ").slice(-1)[0] === targetLast
    );
    if (candidates.length === 1) return candidates[0];
  }

  return null;
}
