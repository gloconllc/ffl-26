// Thin localStorage wrapper. Everything the app persists goes through here so we
// have one place to change the strategy later (e.g. IndexedDB for larger data like
// full-season historical snapshots) without touching every call site.
// Decision: use localStorage/IndexedDB, NOT in-memory-only — see docs/CONTEXT.md.

const NAMESPACE = "ffl26";

function key(name) {
  return `${NAMESPACE}:${name}`;
}

/**
 * @returns {boolean} true on success, false if the write failed (quota exceeded,
 *   private-browsing storage lockout, etc.) — previously swallowed silently with no
 *   return value at all, so a failed save of a live draft pick looked identical to a
 *   successful one to every caller. Callers that make a promise like "a page refresh
 *   mid-draft never loses a pick" (see draft-state.js's recordPick/initDraftState)
 *   need to know when that promise didn't hold, so they can surface it instead.
 */
export function saveJSON(name, value) {
  try {
    localStorage.setItem(key(name), JSON.stringify(value));
    return true;
  } catch (err) {
    console.error(`[storage] failed to save "${name}"`, err);
    return false;
  }
}

export function loadJSON(name, fallback = null) {
  try {
    const raw = localStorage.getItem(key(name));
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    console.error(`[storage] failed to load "${name}"`, err);
    return fallback;
  }
}

export function remove(name) {
  localStorage.removeItem(key(name));
}
