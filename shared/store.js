// Minimal event bus — new in the 2026-09-04 architecture rebuild. It's the seam
// between "something changed" (a pick recorded, a setting changed, live data
// loaded, a roster source switched) and "the UI needs to re-render."
//
// Before this rebuild, every module that mutated app state called renderAll()
// directly, which meant every module needed to import render functions from every
// OTHER module — draft-app/app.js grew to 1300+ lines partly because splitting it
// up naively would have created circular imports (e.g. settings needs to trigger a
// re-render of recommendation cards, but recommendation reads settings like the
// current strategy preset).
//
// Now a module that changes something just calls notifyAppChange() — it doesn't
// need to know who's listening or what a "full re-render" even means. draft-app/
// app.js (the only file that knows about every panel) is the sole subscriber, and
// decides how to actually re-render. Every other module stays independent of every
// other module.
const listeners = new Set();

export function onAppChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyAppChange() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      // A listener throwing must never stop other listeners from running, or
      // silently swallow the fact that something went wrong — app.js's own listener
      // has its own per-section try/catch (see renderAll), but this is the backstop.
      console.error("[store] onAppChange listener failed", err);
    }
  });
}
