// Shared, dependency-free DOM/UI helpers used across every module — error handling,
// busy-button state, HTML escaping, and the small render helpers (avatars, injury
// badges, tier bars) that don't belong to any one panel. Deliberately has zero
// imports from any other draft-app module, so every other module can depend on this
// one without any risk of a circular import.

// --- Error boundary --------------------------------------------------------------
// Non-negotiable requirement (user, draft night): the app must never crash, blank,
// or freeze silently. Every entry point (event handlers, the boot sequence, and
// anything Chart.js/browser APIs throw asynchronously) funnels through here so a
// real error always surfaces as a small dismissible banner instead of a dead page.
export function showErrorBanner(label, err) {
  const banner = document.getElementById("error-banner");
  const text = document.getElementById("error-banner-text");
  if (!banner || !text) {
    // Absolute last resort if the banner itself isn't in the DOM for some reason.
    console.error(`[${label}]`, err);
    return;
  }
  const message = err && err.message ? err.message : String(err);
  text.textContent = `Something went wrong (${label}): ${message} — the rest of the app should still work. Try the action again, or refresh if it repeats.`;
  banner.hidden = false;
  try {
    logDebug(`Error boundary caught (${label})`, { message, stack: err && err.stack });
  } catch {
    // logDebug itself failing must never re-throw and hide the banner we just set.
  }
}

/** Wrap any event-handler function so a thrown error (sync or from a returned
 * promise) shows the banner instead of silently dying and leaving the UI stuck. */
export function safe(fn, label) {
  return function safeWrapped(...args) {
    try {
      const result = fn.apply(this, args);
      if (result && typeof result.catch === "function") {
        result.catch((err) => showErrorBanner(label, err));
      }
      return result;
    } catch (err) {
      showErrorBanner(label, err);
      return undefined;
    }
  };
}

/** Disables a button and shows a spinner for the duration of `fn` (sync or async) —
 * so a click always visibly registers immediately, never "did that do anything?" */
export async function withBusy(btn, fn) {
  if (!btn) return fn();
  btn.classList.add("is-busy");
  btn.disabled = true;
  try {
    return await fn();
  } finally {
    btn.classList.remove("is-busy");
    btn.disabled = false;
  }
}

// --- HTML escaping ------------------------------------------------------------
// Player names/teams come from our own curated dataset today, but Yahoo/ESPN sync
// means externally-sourced strings (most concretely, ESPN team names — genuinely
// user-controlled text) reach these same render paths too. Escape everywhere a
// dynamic string is interpolated into an HTML template rather than set via
// textContent, so this can't become a stored-XSS vector as more live data flows in.
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

// --- Debug output helper ------------------------------------------------------
export function logDebug(label, data) {
  const el = document.getElementById("debug-output");
  if (!el) return;
  el.hidden = false;
  el.textContent += `\n[${new Date().toISOString()}] ${label}\n${JSON.stringify(data, null, 2)}\n`;
  el.scrollTop = el.scrollHeight;
}

// --- Player render helpers (used by board/recommendation/roster-lineup) -----------
export function playerAvatarHtml(player) {
  const pos = escapeHtml(player.position);
  if (!player.headshot) return `<span class="avatar avatar-fallback">${pos}</span>`;
  // Note the onerror handler is itself a JS string literal embedded in an HTML
  // attribute — position needs both HTML-escaping (for the outer attribute) and its
  // own quotes neutralized so it can't break out of the single-quoted JS string.
  const posForJs = pos.replace(/'/g, "&#39;");
  return `<img class="avatar" src="${escapeHtml(player.headshot)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;avatar avatar-fallback&quot;>${posForJs}</span>'" />`;
}

export function injuryBadgeHtml(player) {
  const status = (player.injuryStatus || "").toLowerCase();
  if (!status) return "";
  const cls = status.includes("out") || status.includes("ir")
    ? "injury-out"
    : status.includes("doubtful")
      ? "injury-doubtful"
      : "injury-questionable";
  return `<span class="injury-badge ${cls}" title="${escapeHtml(player.injuryNote || "")}">${escapeHtml(player.injuryStatus)}</span>`;
}

// --- Tier-breakdown visualization (no chart library needed for this one — four
// small percentage bars, color-coded, one per scoring tier) --------------------------
const TIER_LABELS = { projections: "Proj", efficiency: "Eff", contextual: "Ctx", risk: "Risk" };
export function renderTierBars(tierBreakdown) {
  const rows = Object.entries(TIER_LABELS)
    .map(([key, label]) => {
      const value = Math.max(0, Math.min(100, Math.round(tierBreakdown[key] ?? 0)));
      return `
        <div class="tier-bar-row">
          <span class="tier-bar-label">${label}</span>
          <div class="tier-bar-track"><div class="tier-bar-fill tier-bar-${key}" style="width:${value}%"></div></div>
          <span class="tier-bar-value">${value}</span>
        </div>`;
    })
    .join("");
  return `<div class="tier-bars">${rows}</div>`;
}
