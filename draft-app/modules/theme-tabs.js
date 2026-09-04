// Theme toggle + tab navigation — self-contained UI chrome with no dependency on
// draft state or any other panel.
import { saveJSON, loadJSON } from "../../shared/storage.js";
import { safe } from "./dom-utils.js";

const THEME_KEY = "theme";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const toggle = document.getElementById("theme-toggle");
  if (toggle) toggle.textContent = theme === "light" ? "☀" : "☾";
}

export function initTheme() {
  const saved = loadJSON(THEME_KEY, "dark");
  applyTheme(saved);
  const toggle = document.getElementById("theme-toggle");
  if (!toggle) return;
  toggle.addEventListener(
    "click",
    safe(() => {
      const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      saveJSON(THEME_KEY, next);
      applyTheme(next);
    }, "toggle theme")
  );
}

export function initTabs() {
  const tabButtons = document.querySelectorAll(".tab-btn");
  tabButtons.forEach((btn) => {
    btn.addEventListener(
      "click",
      safe(() => {
        tabButtons.forEach((b) => b.classList.remove("is-active"));
        document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
        btn.classList.add("is-active");
        document.getElementById(`panel-${btn.dataset.panel}`).classList.add("is-active");
      }, "switch tab")
    );
  });
}
