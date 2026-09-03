// Thin localStorage wrapper. Everything the app persists goes through here so we
// have one place to change the strategy later (e.g. IndexedDB for larger data like
// full-season historical snapshots) without touching every call site.
// Decision: use localStorage/IndexedDB, NOT in-memory-only — see docs/CONTEXT.md.

const NAMESPACE = "ffl26";

function key(name) {
  return `${NAMESPACE}:${name}`;
}

export function saveJSON(name, value) {
  try {
    localStorage.setItem(key(name), JSON.stringify(value));
  } catch (err) {
    console.error(`[storage] failed to save "${name}"`, err);
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
