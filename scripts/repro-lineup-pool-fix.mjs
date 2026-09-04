// Verifies the Lineup Optimizer fix: it now scores against the full league player
// pool (cachedPlayers) instead of just the ~15 players on the roster, and reads the
// real league size off draft-state instead of hardcoding 10 teams. Indirect check
// (no internal hook exposed): draft into a small (e.g. 4-team) league and confirm the
// Lineup tab still renders sensible scores/tiers rather than crashing or producing
// NaN/degenerate output from a starved replacement-level calculation.
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

await page.click('.tab-btn[data-panel="board"]');
await page.waitForTimeout(200);
await page.fill("#setup-teams", "4"); // small, non-default league size
await page.fill("#setup-slot", "1");
await page.click("#setup-start-btn");
await page.waitForTimeout(500);

for (let i = 0; i < 8; i++) {
  await page.click('.tab-btn[data-panel="recommend"]');
  await page.waitForTimeout(150);
  const btn = page.locator("#available-table tbody .btn-draft").first();
  if (await btn.count()) {
    await btn.click({ force: true });
    await page.waitForTimeout(150);
  }
  await page.click('.tab-btn[data-panel="board"]');
  await page.waitForTimeout(100);
  const simBtn = page.locator("#simulate-btn");
  if (await simBtn.isVisible()) {
    await simBtn.click();
    await page.waitForTimeout(500);
  }
}

await page.click('.tab-btn[data-panel="lineup"]');
await page.waitForTimeout(500);
const scoresText = await page.locator("#lineup-content td.numeric strong").allInnerTexts();
console.log("Lineup score cells:", scoresText);
const allNumeric = scoresText.length > 0 && scoresText.every((s) => /^\d+$/.test(s.trim()));
console.log("All lineup scores are plain finite numbers (no NaN/undefined):", allNumeric);

console.log("\nPage errors:", pageErrors.length ? pageErrors : "none");
const ok = allNumeric && pageErrors.length === 0;
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
await browser.close();
process.exit(ok ? 0 : 1);
