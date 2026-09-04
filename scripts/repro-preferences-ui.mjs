// Verifies the new player-preferences add/remove UI (Settings tab) — the largest item
// from the 2026-09-04 full-app review, previously entirely unbuilt beyond one
// hardcoded seed value (Lamar Jackson).
import pkg from "/home/claude/.npm-global/lib/node_modules/playwright/index.js";
const { chromium } = pkg;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(8000);
const pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(err.message));

await page.goto("http://localhost:8532/draft-app/draft-app.html", { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);

await page.click('.tab-btn[data-panel="settings"]');
await page.waitForTimeout(300);

// Seed preference (Lamar Jackson) should already be listed.
const initialRows = await page.locator("#preferences-list tbody tr").count();
console.log("Initial preference rows (expect 1, the seed):", initialRows);

// Add a new preference, including a name with characters that would break naive HTML
// interpolation, to double-check the escaping fix as part of the same flow.
await page.fill("#pref-player-name", `<script>window.__xss=1</script>O'Brien`);
await page.fill("#pref-note", `<img src=x onerror="window.__xss2=1">`);
await page.click("#pref-add-btn");
await page.waitForTimeout(300);

const rowsAfterAdd = await page.locator("#preferences-list tbody tr").count();
console.log("Rows after adding one (expect 2):", rowsAfterAdd);

const xssFired = await page.evaluate(() => Boolean(window.__xss || window.__xss2));
console.log("XSS payload executed (must be false):", xssFired);

const rowText = await page.locator("#preferences-list tbody tr").nth(1).innerText();
console.log("New row's visible text (should show the literal text, not run it):", JSON.stringify(rowText));

// Remove the newly-added one, confirm it's gone and the seed remains.
await page.locator("#preferences-list .btn-pref-remove").nth(1).click();
await page.waitForTimeout(300);
const rowsAfterRemove = await page.locator("#preferences-list tbody tr").count();
console.log("Rows after removing the new one (expect 1, back to seed):", rowsAfterRemove);

// Confirm it actually persisted to storage (not just DOM state).
const persisted = await page.evaluate(() => {
  const raw = localStorage.getItem("ffl26:user_preferences");
  return raw ? JSON.parse(raw).playerPreferences.length : null;
});
console.log("Persisted playerPreferences.length after remove (expect 1):", persisted);

console.log("\nPage errors:", pageErrors.length ? pageErrors : "none");
const ok =
  initialRows === 1 &&
  rowsAfterAdd === 2 &&
  xssFired === false &&
  rowsAfterRemove === 1 &&
  persisted === 1 &&
  pageErrors.length === 0;
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
